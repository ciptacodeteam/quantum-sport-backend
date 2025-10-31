import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { checkoutSchema, CheckoutSchema } from '@/lib/validation'
import { xenditService } from '@/services/xendit.service'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, PaymentStatus, SlotType } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { env } from '@/env'
import { requireAuth } from '@/middlewares/auth'

// const PROCESSING_FEE_PERCENT = 0.02 // 2% processing fee

export const checkoutHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', checkoutSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      const validated = c.req.valid('json') as CheckoutSchema
      const {
        bookingId,
        paymentMethodId,
        courtSlots,
        coachSlots,
        ballboySlots,
        inventories,
      } = validated

      // Validate at least one slot is provided
      const hasSlots =
        (courtSlots && courtSlots.length > 0) ||
        (coachSlots && coachSlots.length > 0) ||
        (ballboySlots && ballboySlots.length > 0)
      if (!hasSlots) {
        return c.json(
          err('At least one slot must be selected', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      // Validate payment method
      const paymentMethod = await db.paymentMethod.findUnique({
        where: { id: paymentMethodId },
      })
      if (!paymentMethod) {
        throw new NotFoundException('Payment method not found')
      }
      if (!paymentMethod.isActive) {
        return c.json(
          err('Payment method is not active', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      const result = await db.$transaction(async (tx) => {
        // Find or create booking
        let booking
        if (bookingId) {
          booking = await tx.booking.findUnique({
            where: { id: bookingId },
            include: {
              details: true,
              coaches: true,
              ballboys: true,
              inventories: true,
            },
          })
          if (!booking) {
            throw new NotFoundException('Booking not found')
          }
          if (booking.userId !== user.id) {
            throw new BadRequestException('Unauthorized access to booking')
          }
          if (booking.status !== BookingStatus.HOLD) {
            throw new BadRequestException('Booking is not in HOLD status')
          }

          // Clear existing details
          await tx.bookingDetail.deleteMany({
            where: { bookingId: booking.id },
          })
          await tx.bookingCoach.deleteMany({
            where: { bookingId: booking.id },
          })
          await tx.bookingBallboy.deleteMany({
            where: { bookingId: booking.id },
          })
          await tx.bookingInventory.deleteMany({
            where: { bookingId: booking.id },
          })
        } else {
          booking = await tx.booking.create({
            data: {
              userId: user.id,
              status: BookingStatus.HOLD,
              totalPrice: 0,
              processingFee: 0,
            },
          })
        }

        let totalPrice = 0
        const xenditItems: Array<{ name: string; quantity: number; price: number }> = []

        // Process court slots
        if (courtSlots && courtSlots.length > 0) {
          const courtSlotData = await tx.slot.findMany({
            where: {
              id: { in: courtSlots },
              type: SlotType.COURT,
              isAvailable: true,
            },
            include: {
              bookingDetails: { select: { id: true }, take: 1 },
            },
          })

          if (courtSlotData.length !== courtSlots.length) {
            throw new BadRequestException(
              'One or more court slots not found or unavailable',
            )
          }

          for (const slot of courtSlotData) {
            if (slot.bookingDetails.length > 0) {
              throw new BadRequestException(
                'One or more court slots are already booked',
              )
            }
            totalPrice += slot.price

            await tx.bookingDetail.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                price: slot.price,
                courtId: slot.courtId || undefined,
              },
            })
            xenditItems.push({
              name: `Court booking ${dayjs(slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(slot.endAt).format('HH:mm')}`,
              quantity: 1,
              price: slot.price,
            })
          }
        }

        // Process coach slots
        if (coachSlots && coachSlots.length > 0) {
          const coachSlotData = await tx.slot.findMany({
            where: {
              id: { in: coachSlots },
              type: SlotType.COACH,
              isAvailable: true,
            },
            include: {
              bookingCoaches: { select: { id: true }, take: 1 },
            },
          })

          if (coachSlotData.length !== coachSlots.length) {
            throw new BadRequestException(
              'One or more coach slots not found or unavailable',
            )
          }

          for (const slot of coachSlotData) {
            if (slot.bookingCoaches.length > 0) {
              throw new BadRequestException(
                'One or more coach slots are already booked',
              )
            }
            totalPrice += slot.price

            // Get coach type for the staff
            const coachTypes = await tx.bookingCoachType.findMany()
            const firstCoachType = coachTypes[0]
            if (!firstCoachType) {
              throw new BadRequestException('No coach types available')
            }

            await tx.bookingCoach.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                bookingCoachTypeId: firstCoachType.id,
                price: slot.price,
              },
            })
            xenditItems.push({
              name: `Coach session ${dayjs(slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(slot.endAt).format('HH:mm')}`,
              quantity: 1,
              price: slot.price,
            })
          }
        }

        // Process ballboy slots
        if (ballboySlots && ballboySlots.length > 0) {
          const ballboySlotData = await tx.slot.findMany({
            where: {
              id: { in: ballboySlots },
              type: SlotType.BALLBOY,
              isAvailable: true,
            },
            include: {
              bookingBallboys: { select: { id: true }, take: 1 },
            },
          })

          if (ballboySlotData.length !== ballboySlots.length) {
            throw new BadRequestException(
              'One or more ballboy slots not found or unavailable',
            )
          }

          for (const slot of ballboySlotData) {
            if (slot.bookingBallboys.length > 0) {
              throw new BadRequestException(
                'One or more ballboy slots are already booked',
              )
            }
            totalPrice += slot.price

            await tx.bookingBallboy.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                price: slot.price,
              },
            })
            xenditItems.push({
              name: `Ballboy session ${dayjs(slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(slot.endAt).format('HH:mm')}`,
              quantity: 1,
              price: slot.price,
            })
          }
        }

        // Process inventories
        if (inventories && inventories.length > 0) {
          for (const inv of inventories) {
            const inventory = await tx.inventory.findUnique({
              where: { id: inv.inventoryId },
            })
            if (!inventory) {
              throw new NotFoundException(
                `Inventory ${inv.inventoryId} not found`,
              )
            }
            if (!inventory.isActive) {
              throw new BadRequestException(
                `Inventory ${inventory.name} is not active`,
              )
            }
            if (inventory.quantity < inv.quantity) {
              throw new BadRequestException(
                `Insufficient quantity for ${inventory.name}`,
              )
            }

            await tx.bookingInventory.create({
              data: {
                bookingId: booking.id,
                inventoryId: inv.inventoryId,
                quantity: inv.quantity,
                price: 0, // You may want to add pricing to inventory
              },
            })
            xenditItems.push({
              name: `Inventory - ${inventory.name}`,
              quantity: inv.quantity,
              price: 0,
            })
          }
        }

        // Calculate processing fee
        // const processingFee = Math.round(totalPrice * PROCESSING_FEE_PERCENT)
        const processingFee = paymentMethod.fees
        const finalTotal = totalPrice + processingFee
        if (processingFee > 0) {
          xenditItems.push({ name: 'Processing fee', quantity: 1, price: processingFee })
        }

        // Update booking with totals
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            totalPrice,
            processingFee,
          },
        })

        // Get user details for Xendit
        const userDetails = await tx.user.findUnique({
          where: { id: user.id },
          select: { name: true, email: true, phone: true },
        })

        // Generate invoice number
        const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`

        // Create invoice
        const invoice = await tx.invoice.create({
          data: {
            userId: user.id,
            bookingId: booking.id,
            number: invoiceNumber,
            subtotal: totalPrice,
            processingFee,
            total: finalTotal,
            status: PaymentStatus.PENDING,
            dueDate: dayjs().add(1, 'day').toDate(), // Payment due in 1 day
            issuedAt: new Date(),
          },
        })

        // --- OLD v2 Invoice (disabled, see below to re-enable) ---
        /*
        let xenditInvoiceResponse: any = null
        if (env.xendit.apiKey) {
          try {
            xenditInvoiceResponse = await xenditService.createInvoice({
              externalId: invoice.id,
              amount: finalTotal,
              payerEmail: userDetails?.email || undefined,
              description: `Payment for booking ${booking.id}`,
              invoiceDuration: 600, // 10 minutes
              successRedirectUrl: `${env.baseUrl}/payment/success`,
              failureRedirectUrl: `${env.baseUrl}/payment/failed`,
              items: xenditItems,
              customer: {
                givenNames: userDetails?.name || 'Customer',
                email: userDetails?.email || undefined,
                mobileNumber: userDetails?.phone || undefined,
              },
              // payment_methods: paymentMethod.channel ? [paymentMethod.channel] : undefined, // Only needed if supporting v2 and you've implemented preference filtering
            })
          } catch (error) {
            c.var.logger.error(`Failed to create Xendit invoice: ${error}`)
            // Continue without Xendit integration
          }
        }
        */

        // --- NEW v3 /payment_requests (enabled) ---
        let xenditInvoiceResponse: any = null;
        if (env.xendit.apiKey) {
          try {
            // Build channel_properties based on the payment method/channel
            const channelCode = (paymentMethod as any).channel || '';
            let channelProperties: Record<string, any> = {};

            if (channelCode === 'CARDS') {
              channelProperties = {
                mid_label: 'mid_label_acquirer_1',
                card_details: {
                  cvn: '246',
                  card_number: '2222444466668888',
                  expiry_year: '2027',
                  expiry_month: '12',
                  cardholder_first_name: userDetails?.name?.split(' ')[0] || 'John',
                  cardholder_last_name: userDetails?.name?.split(' ').slice(1).join(' ') || 'Doe',
                  cardholder_email: userDetails?.email || 'payments@xendit.co',
                  cardholder_phone_number: userDetails?.phone || '+6571234567',
                },
                skip_three_ds: false,
                card_on_file_type: 'MERCHANT_UNSCHEDULED',
                failure_return_url: `${env.baseUrl}/payment/failed`,
                success_return_url: `${env.baseUrl}/payment/success`,
                billing_information: {
                  city: 'Singapore',
                  country: 'SG',
                  postal_code: '644228',
                  street_line1: 'Merlion Bay Sands Suites',
                  street_line2: '21-37',
                  province_state: 'Singapore',
                },
                statement_descriptor: 'Goods & Services',
                transaction_sequence: 'SUBSEQUENT',
                network_transaction_id: 'MPL67M01P0628',
                recurring_configuration: {
                  recurring_expiry: '2025-12-01',
                  recurring_frequency: 30,
                },
              };
            } else if (channelCode === 'QR') {
              channelProperties = {
                // Aligning with example; set reasonable expiry (10 minutes)
                expires_at: dayjs().add(10, 'minutes').toISOString(),
              };
            } else if (channelCode === 'MANDIRI_VIRTUAL_ACCOUNT') {
              channelProperties = {
                expires_at: dayjs().add(10, 'minutes').toISOString(),
                display_name: userDetails?.name || 'John Doe',
                // virtual_account_number: '88696969696988', // Optional: set if you manage VA numbers yourself
                verification_data: {
                  customer_name: userDetails?.name || 'John Doe',
                  accepted_name_variations: [
                    userDetails?.name?.split(' ')[0] || 'John',
                    userDetails?.name || 'John Doe',
                  ],
                  allowed_bank_accounts: [
                    {
                      bank_name: 'BRI',
                      account_number: '2876783233',
                      account_name: userDetails?.name || 'John Doe',
                    },
                  ],
                },
              };
            }

            xenditInvoiceResponse = await xenditService.createPaymentRequestV3({
              referenceId: invoice.id,
              requestAmount: finalTotal,
              country: 'ID',
              currency: 'IDR',
              captureMethod: 'AUTOMATIC',
              channelCode,
              channelProperties,
              description: `Payment for booking ${booking.id}`,
              metadata: {
                bookingId: booking.id,
                userId: user.id,
              }
            });
          } catch (error) {
            c.var.logger.error(`Failed to create Xendit v3 payment request: ${error}`);
            // Continue without Xendit integration
          }
        }

        // Create payment
        const payment = await tx.payment.create({
          data: {
            paymentMethodId: paymentMethod.id,
            amount: finalTotal,
            fees: paymentMethod.fees,
            status: PaymentStatus.PENDING,
            dueDate: dayjs().add(10, 'minutes').toDate(),
            externalRef: xenditInvoiceResponse?.id || null,
            meta: xenditInvoiceResponse
              ? JSON.stringify({
                  invoiceId: xenditInvoiceResponse.id,
                  invoiceUrl: xenditInvoiceResponse.invoice_url,
                  status: xenditInvoiceResponse.status,
                })
              : undefined,
          },
        })

        // Link payment to invoice
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paymentId: payment.id },
        })

        // Set hold expiry (if payment method requires it)
        const holdExpiresAt =
          paymentMethod.fees === 0
            ? dayjs().add(24, 'hours').toDate()
            : dayjs().add(15, 'minutes').toDate()

        // Update booking status to HOLD
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.HOLD,
            holdExpiresAt,
          },
        })

        return {
          booking,
          invoice,
          payment,
          xenditInvoiceUrl: xenditInvoiceResponse?.actions?.mobile_web_checkout_url || xenditInvoiceResponse?.invoice_url || null,
        }
      })

      return c.json(
        ok(
          {
            bookingId: result.booking.id,
            invoiceNumber: result.invoice.number,
            totalPrice: result.booking.totalPrice,
            processingFee: result.booking.processingFee,
            total: result.invoice.total,
            status: result.booking.status,
            paymentUrl: result.xenditInvoiceUrl,
          },
          'Checkout successful',
        ),
      )
    } catch (err) {
      c.var.logger.fatal(`Error during checkout: ${err}`)
      throw err
    }
  },
)
