import { env } from '@/env'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { generateInvoiceNumber } from '@/lib/utils'
import { requireAuth } from '@/middlewares/auth'
import { xenditService } from '@/services/xendit.service'
import { AWAITING_PAYMENT_SUSPENSION_REASON } from '@/services/membership-activation.service'
import { zValidator } from '@hono/zod-validator'
import { PaymentStatus } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'

const membershipCheckoutSchema = z.object({
  membershipId: z.string(),
  paymentMethodId: z.string(),
  cardPayment: z
    .object({
      savedCardId: z.string().optional(),
      cvv: z.string().optional(),
      cardNumber: z.string().optional(),
      cardholderName: z.string().optional(),
      expiryMonth: z.number().optional(),
      expiryYear: z.number().optional(),
      newCardCvv: z.string().optional(),
      saveCard: z.boolean().optional(),
    })
    .optional(),
})

type MembershipCheckoutSchema = z.infer<typeof membershipCheckoutSchema>

export const membershipCheckoutHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', membershipCheckoutSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        return c.json(
          { success: false, msg: 'Unauthorized' },
          status.UNAUTHORIZED,
        )
      }

      const validated = c.req.valid('json') as MembershipCheckoutSchema
      const { membershipId, paymentMethodId } = validated

      // Validate membership
      const membership = await db.membership.findUnique({
        where: { id: membershipId },
        include: { benefits: true },
      })
      if (!membership) {
        throw new NotFoundException('Membership not found')
      }
      if (!membership.isActive) {
        throw new BadRequestException('Membership is not active')
      }

      // Validate payment method
      const paymentMethod = await db.paymentMethod.findUnique({
        where: { id: paymentMethodId },
      })
      if (!paymentMethod) {
        throw new NotFoundException('Payment method not found')
      }
      if (!paymentMethod.isActive) {
        throw new BadRequestException('Payment method is not active')
      }

      const result = await db.$transaction(async (tx) => {
        // Calculate totals (fixed fee + percentage fee + 11% VAT)
        const subtotal = membership.price
        const percentageFee = Math.round(
          subtotal * (Number(paymentMethod.percentage) / 100),
        )
        const baseFee = paymentMethod.fees + percentageFee
        const vat = Math.round(baseFee * 0.11) // 11% VAT on total fee
        const processingFee = baseFee + vat
        const finalTotal = subtotal + processingFee

        // Generate invoice number
        const invoiceNumber = await generateInvoiceNumber()

        // Create MembershipUser as suspended until payment succeeds (B4)
        const startDate = dayjs().toDate()
        const endDate = dayjs().add(membership.duration, 'days').toDate()

        const membershipUser = await tx.membershipUser.create({
          data: {
            userId: user.id,
            membershipId: membership.id,
            startDate,
            endDate,
            remainingSessions: membership.sessions,
            remainingDuration: membership.duration,
            isExpired: false,
            isSuspended: true,
            suspensionReason: AWAITING_PAYMENT_SUSPENSION_REASON,
          },
        })

        // Create invoice
        const invoice = await tx.invoice.create({
          data: {
            userId: user.id,
            membershipUserId: membershipUser.id,
            number: invoiceNumber,
            subtotal,
            processingFee,
            total: finalTotal,
            status: PaymentStatus.PENDING,
            dueDate: dayjs().add(1, 'day').toDate(),
            issuedAt: new Date(),
          },
        })

        // --- Xendit Payment Request v3 Integration ---
        let xenditInvoiceResponse: any = null
        let xenditError: any = null
        if (paymentMethod.channel) {
          if (!env.xendit.apiKey) {
            throw new BadRequestException(
              'Payment gateway unavailable. Please try again later (missing API key).',
            )
          }
          try {
            const channelCode = (paymentMethod as any).channel || ''
            let channelProperties: Record<string, any> = {}
            const userDetails = await tx.user.findUnique({
              where: { id: user.id },
              select: { name: true, email: true, phone: true },
            })

            if (channelCode === 'MANDIRI_VIRTUAL_ACCOUNT') {
              channelProperties = {
                expires_at: dayjs().add(24, 'hours').toISOString(),
                display_name: userDetails?.name || 'Customer',
              }
            } else if (channelCode.includes('VIRTUAL_ACCOUNT')) {
              // Other VA channels (BCA, BNI, BRI, etc.) also require display_name
              channelProperties = {
                expires_at: dayjs().add(24, 'hours').toISOString(),
                display_name: userDetails?.name || 'Customer',
              }
            } else if (channelCode === 'QRIS' || channelCode === 'QR') {
              channelProperties = {
                expires_at: dayjs().add(1, 'hour').toISOString(),
              }
            } else if (
              channelCode.includes('EWALLET') ||
              ['DANA', 'OVO', 'LINKAJA', 'SHOPEEPAY'].includes(channelCode)
            ) {
              channelProperties = {
                success_return_url: `${env.frontEndUrl}/payment/success?invoice_id=${invoice.id}`,
                failure_return_url: `${env.frontEndUrl}/payment/failed?invoice_id=${invoice.id}`,
              }
            } else {
              channelProperties = {
                expires_at: dayjs().add(1, 'hour').toISOString(),
              }
            }

            c.var.logger.info(
              `Creating Xendit payment request channel=${channelCode} amount=${finalTotal}`,
            )
            xenditInvoiceResponse = await xenditService.createPaymentRequestV3({
              referenceId: invoiceNumber,
              requestAmount: finalTotal,
              country: 'ID',
              currency: 'IDR',
              captureMethod: 'AUTOMATIC',
              channelCode,
              channelProperties,
              description: `Payment for membership ${membership.name}`,
              metadata: {
                membershipUserId: membershipUser.id,
                userId: user.id,
                invoiceNumber: invoice.number,
                membershipId: membership.id,
              },
            })
          } catch (errX: any) {
            const errMsg = errX?.message || 'Payment gateway error'
            xenditError = {
              message: errMsg,
              code:
                errMsg.includes('IP allowlist') || errMsg.includes('allowlist')
                  ? 'XENDIT_IP_NOT_ALLOWLIST'
                  : errMsg.includes('channel_properties')
                    ? 'XENDIT_CHANNEL_PROPERTIES_INVALID'
                    : errMsg.includes('below the minimum limit') ||
                        errMsg.includes('minimum amount')
                      ? 'XENDIT_AMOUNT_TOO_LOW'
                      : 'XENDIT_ERROR',
            }
            c.var.logger.error(
              `Xendit error: ${xenditError.code} - ${xenditError.message}`,
            )
          }
          if (!xenditInvoiceResponse) {
            // Provide user-friendly error messages based on error code
            let userMessage = xenditError?.message || 'Payment gateway error'
            if (xenditError?.code === 'XENDIT_AMOUNT_TOO_LOW') {
              userMessage = `Payment amount (Rp ${finalTotal.toLocaleString('id-ID')}) is below the minimum limit required by the payment method. Please choose a different payment method.`
            } else if (xenditError?.code === 'XENDIT_IP_NOT_ALLOWLIST') {
              userMessage =
                'Payment gateway configuration error. Please contact support.'
            } else if (
              xenditError?.code === 'XENDIT_CHANNEL_PROPERTIES_INVALID'
            ) {
              userMessage =
                'Payment method configuration error. Please try a different payment method or contact support.'
            }

            throw new BadRequestException(
              `Unable to initialize payment. ${userMessage}`,
            )
          }
        }

        // Create payment
        const payment = await tx.payment.create({
          data: {
            paymentMethodId: paymentMethod.id,
            amount: finalTotal,
            fees: paymentMethod.fees,
            status: PaymentStatus.PENDING,
            dueDate: dayjs().add(24, 'hours').toDate(),
            externalRef: xenditInvoiceResponse?.id || null,
            // Store as JSON object to Prisma Json column (not string)
            meta: xenditInvoiceResponse
              ? {
                  payment_request_id: xenditInvoiceResponse.id,
                  reference_id: xenditInvoiceResponse.reference_id,
                  status: xenditInvoiceResponse.status,
                  channel_code: xenditInvoiceResponse.channel_code,
                  channel_properties: xenditInvoiceResponse.channel_properties,
                  actions: xenditInvoiceResponse.actions,
                  request_amount: xenditInvoiceResponse.request_amount,
                  currency: xenditInvoiceResponse.currency,
                  created: xenditInvoiceResponse.created,
                }
              : undefined,
          },
        })

        // Link payment to invoice
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paymentId: payment.id },
        })

        return {
          membershipUser,
          invoice,
          payment,
          xenditPaymentRequest: xenditInvoiceResponse,
        }
      })

      // Extract payment actions for frontend
      let paymentActions: any = null
      let redirectUrl: string | null = null

      if (
        result.xenditPaymentRequest?.actions &&
        result.xenditPaymentRequest.actions.length > 0
      ) {
        paymentActions = result.xenditPaymentRequest.actions.map(
          (action: any) => ({
            type: action.type,
            value: action.value,
            descriptor: action.descriptor,
          }),
        )

        // Find redirect URL if available
        const redirectAction = result.xenditPaymentRequest.actions.find(
          (a: any) => a.type === 'REDIRECT_CUSTOMER',
        )
        redirectUrl = redirectAction?.value || null
      }

      return c.json(
        ok(
          {
            membershipUserId: result.membershipUser.id,
            invoiceId: result.invoice.id,
            invoiceNumber: result.invoice.number,
            subtotal: result.invoice.subtotal,
            processingFee: result.invoice.processingFee,
            total: result.invoice.total,
            paymentStatus: result.xenditPaymentRequest?.status || 'PENDING',
            paymentActions,
            // Legacy support
            paymentUrl: redirectUrl,
            membership: {
              id: membership.id,
              name: membership.name,
              startDate: result.membershipUser.startDate,
              endDate: result.membershipUser.endDate,
              sessions: result.membershipUser.remainingSessions,
            },
          },
          'Membership checkout successful',
        ),
      )
    } catch (err) {
      c.var.logger.fatal(`Error during membership checkout: ${err}`)
      throw err
    }
  },
)
