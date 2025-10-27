import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import {
  checkoutSchema,
  CheckoutSchema,
} from '@/lib/validation'
import { xenditService } from '@/services/xendit.service'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, PaymentStatus, SlotType } from 'generated/prisma'
import dayjs from 'dayjs'
import status from 'http-status'
import { env } from '@/env'

const PROCESSING_FEE_PERCENT = 0.02 // 2% processing fee

export const checkoutHandler = factory.createHandlers(
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
          if (booking.status !== BookingStatus.DRAFT) {
            throw new BadRequestException('Booking is not in DRAFT status')
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
              status: BookingStatus.DRAFT,
              totalPrice: 0,
              processingFee: 0,
            },
          })
        }

        let totalPrice = 0

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
            throw new BadRequestException('One or more court slots not found or unavailable')
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
            throw new BadRequestException('One or more coach slots not found or unavailable')
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
            throw new BadRequestException('One or more ballboy slots not found or unavailable')
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
          }
        }

        // Process inventories
        if (inventories && inventories.length > 0) {
          for (const inv of inventories) {
            const inventory = await tx.inventory.findUnique({
              where: { id: inv.inventoryId },
            })
            if (!inventory) {
              throw new NotFoundException(`Inventory ${inv.inventoryId} not found`)
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
          }
        }

        // Calculate processing fee
        const processingFee = Math.round(totalPrice * PROCESSING_FEE_PERCENT)
        const finalTotal = totalPrice + processingFee

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

        // Create Xendit invoice if API key is configured
        let xenditInvoiceResponse: any = null
        if (env.xendit.apiKey) {
          try {
            xenditInvoiceResponse = await xenditService.createInvoice({
              externalId: invoice.id,
              amount: finalTotal,
              payerEmail: userDetails?.email || undefined,
              description: `Payment for booking ${booking.id}`,
              invoiceDuration: 86400, // 24 hours
              successRedirectUrl: `${env.baseUrl}/payment/success`,
              failureRedirectUrl: `${env.baseUrl}/payment/failed`,
              customer: {
                givenNames: userDetails?.name || 'Customer',
                email: userDetails?.email || undefined,
                mobileNumber: userDetails?.phone || undefined,
              },
            })
          } catch (error) {
            c.var.logger.error(`Failed to create Xendit invoice: ${error}`)
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
            dueDate: dayjs().add(1, 'day').toDate(),
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
          xenditInvoiceUrl: xenditInvoiceResponse?.invoice_url || null,
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

