import {
  paymentDeadline,
  PAYMENT_WINDOW_MINUTES,
} from '@/lib/booking-time-policy'
import { env } from '@/env'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { generateInvoiceNumber } from '@/lib/utils'
import { requireAuth } from '@/middlewares/auth'
import { midtransService } from '@/services/midtrans.service'
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
      tokenId: z.string().min(1).optional(),
      savedCardId: z.string().optional(),
      cvv: z.string().optional(),
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

        // Online Value Pack purchases are branch-independent. The invoice keeps
        // its central accounting default; this never restricts playing location.
        const issuedAt = new Date()
        const invoice = await tx.invoice.create({
          data: {
            userId: user.id,
            membershipUserId: membershipUser.id,
            number: invoiceNumber,
            subtotal,
            processingFee,
            total: finalTotal,
            status: PaymentStatus.PENDING,
            dueDate: paymentDeadline(issuedAt),
            issuedAt,
          },
        })

        let paymentInit: Awaited<
          ReturnType<typeof midtransService.initiateCheckoutPayment>
        > | null = null
        if (paymentMethod.channel) {
          if (!env.midtrans.serverKey) {
            throw new BadRequestException(
              'Payment gateway unavailable. Please try again later (missing API key).',
            )
          }
          const channelCode = paymentMethod.channel || ''
          const useSnap = midtransService.checkoutMode() === 'snap'
          if (
            !useSnap &&
            channelCode === 'CARDS' &&
            !validated.cardPayment?.tokenId
          ) {
            throw new BadRequestException(
              'Card token is required for credit card payments.',
            )
          }
          try {
            const userDetails = await tx.user.findUnique({
              where: { id: user.id },
              select: { name: true, email: true, phone: true },
            })
            const expiryMinutes =
              channelCode === 'CARDS' ? undefined : PAYMENT_WINDOW_MINUTES
            c.var.logger.info(
              `Creating Midtrans ${useSnap ? 'snap' : 'charge'} channel=${channelCode} amount=${finalTotal}`,
            )
            paymentInit = await midtransService.initiateCheckoutPayment({
              orderId: invoiceNumber,
              amount: finalTotal,
              channelCode,
              expiryMinutes,
              tokenId: useSnap ? undefined : validated.cardPayment?.tokenId,
              customer: userDetails ?? undefined,
              description: `Payment for membership ${membership.name}`,
            })
          } catch (errX: any) {
            const errMsg = errX?.message || 'Payment gateway error'
            c.var.logger.error(`Midtrans error: ${errMsg}`)
            throw new BadRequestException(
              `Unable to initialize payment. ${errMsg}`,
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
            dueDate: invoice.dueDate,
            externalRef:
              paymentInit?.mode === 'core'
                ? paymentInit.charge.transaction_id
                : paymentInit?.mode === 'snap'
                  ? paymentInit.orderId
                  : null,
            meta: paymentInit?.meta,
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
          paymentInit,
        }
      })

      // Extract payment actions for frontend
      let paymentActions: any = null
      let redirectUrl: string | null = null
      let snapToken: string | null = null
      let snapRedirectUrl: string | null = null
      let paymentStatus = 'PENDING'

      if (result.paymentInit?.mode === 'snap') {
        snapToken = result.paymentInit.snapToken
        snapRedirectUrl = result.paymentInit.snapRedirectUrl
        redirectUrl = result.paymentInit.snapRedirectUrl
        paymentStatus = 'PENDING'
      } else if (result.paymentInit?.mode === 'core') {
        const charge = result.paymentInit.charge
        paymentStatus = charge.status || 'PENDING'
        if (charge.actions?.length) {
          paymentActions = charge.actions.map((action) => ({
            type: action.type,
            value: action.value,
            descriptor: action.descriptor,
          }))
          const redirectAction = charge.actions.find(
            (a) => a.type === 'REDIRECT_CUSTOMER',
          )
          redirectUrl = redirectAction?.value || charge.redirect_url || null
        } else if (charge.redirect_url) {
          redirectUrl = charge.redirect_url
        }
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
            paymentStatus,
            paymentActions,
            ...(snapToken && { snapToken }),
            ...(snapRedirectUrl && { snapRedirectUrl }),
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
