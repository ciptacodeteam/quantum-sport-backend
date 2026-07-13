import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { SearchQuerySchema, searchQuerySchema } from '@/lib/validation'
import { requireAuth } from '@/middlewares/auth'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { z } from 'zod'
import { PaymentStatus, BookingStatus } from '@prisma/client'
import xenditService from '@/services/xendit.service'
import { getFileUrl } from '@/services/upload.service'
import { BadRequestException, NotFoundException } from '@/exceptions'
import dayjs from 'dayjs'
import { restoreMembershipSessionsForCancelledBooking } from '@/services/membership-booking.service'

// GET /invoices
export const getUserInvoicesHandler = factory.createHandlers(
  requireAuth,
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        throw new Error('Unauthorized')
      }

      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { issuedAt: 'desc' },
        searchableFields: ['status', 'dueDate'],
      })

      const invoices = await db.invoice.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          userId: user.id,
        },
        select: {
          id: true,
          number: true,
          status: true,
          subtotal: true,
          processingFee: true,
          // promoCodeText: true,
          promoDiscountAmount: true,
          total: true,
          issuedAt: true,
          dueDate: true,
          paidAt: true,
          booking: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              courtNormalPrice: true,
              courtDiscountPrice: true,
              createdAt: true,
              details: {
                select: {
                  id: true,
                  court: { select: { id: true, name: true } },
                  price: true,
                  discountPrice: true,
                  slot: true,
                  createdAt: true,
                },
              },
            },
          },
          classBooking: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              class: { select: { id: true, name: true } },
            },
          },
          membershipUser: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              membership: { select: { id: true, name: true } },
            },
          },
        },
      })

      return c.json(ok(invoices), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getUserInvoicesHandler: ${error}`)
      throw error
    }
  },
)

// GET /invoices/:id (detail)
export const getInvoiceDetailHandler = factory.createHandlers(
  requireAuth,
  zValidator('param', z.object({ id: z.string().min(1) }), validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        throw new Error('Unauthorized')
      }

      const { id } = c.req.valid('param') as { id: string }

      const invoice: any = await db.invoice.findFirst({
        where: { number: id, userId: user.id },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          booking: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              processingFee: true,
              courtNormalPrice: true,
              courtDiscountPrice: true,
              createdAt: true,
              details: {
                select: {
                  id: true,
                  price: true,
                  discountPrice: true,
                  slot: true,
                  court: { select: { id: true, name: true } },
                },
              },
              inventories: {
                select: {
                  id: true,
                  quantity: true,
                  price: true,
                  inventory: { select: { id: true, name: true } },
                },
              },
              coaches: {
                select: {
                  id: true,
                  price: true,
                  bookingCoachType: { select: { id: true, name: true } },
                  slot: {
                    include: {
                      staff: { select: { id: true, name: true, role: true } },
                    },
                  },
                },
              },
              ballboys: {
                select: {
                  id: true,
                  price: true,
                  slot: {
                    include: {
                      staff: { select: { id: true, name: true, role: true } },
                    },
                  },
                },
              },
            },
          },
          classBooking: {
            select: {
              id: true,
              status: true,
              class: { select: { id: true, name: true } },
            },
          },
          membershipUser: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              membership: { select: { id: true, name: true } },
            },
          },
          payment: {
            select: {
              id: true,
              status: true,
              amount: true,
              fees: true,
              externalRef: true,
              dueDate: true,
              paidAt: true,
              meta: true,
              method: {
                select: {
                  id: true,
                  name: true,
                  logo: true,
                  channel: true,
                  fees: true,
                  percentage: true,
                },
              },
            },
          },
        },
      })

      if (!invoice) {
        return c.json(ok(null, 'Invoice not found'), status.NOT_FOUND)
      }

      // Parse stored meta JSON (if any)
      let storedMeta: any = null
      if (invoice.payment?.meta) {
        try {
          // Prisma already parses Json fields, no need to JSON.parse
          storedMeta =
            typeof invoice.payment.meta === 'string'
              ? JSON.parse(invoice.payment.meta)
              : invoice.payment.meta
        } catch (e) {
          c.var.logger.error(`Failed parsing payment meta: ${e}`)
        }
      }

      // Build payment instructions if pending/awaiting
      let paymentInstructions: any = null
      if (
        invoice.payment &&
        [PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION].includes(
          invoice.payment.status,
        )
      ) {
        // Attempt to fetch live payment request details from Xendit v3
        let paymentRequest: any = null
        if (invoice.payment.externalRef) {
          paymentRequest = await xenditService.getPaymentRequestV3(
            invoice.payment.externalRef,
          )
        }

        const channelCode = paymentRequest?.channel_code
        const channelProps = paymentRequest?.channel_properties || {}
        const actions = paymentRequest?.actions || {}

        // Virtual Account detection (sample heuristic)
        if (channelCode && channelCode.toUpperCase().includes('VA')) {
          paymentInstructions = {
            type: 'VIRTUAL_ACCOUNT',
            bankCode: channelProps.bank_code || channelProps.bank || null,
            accountNumber: channelProps.account_number || null,
            accountName: channelProps.account_name || null,
            expiresAt: invoice.payment.dueDate || null,
          }
        } else if (channelCode && channelCode.toUpperCase().includes('QR')) {
          // QRIS style
          paymentInstructions = {
            type: 'QRIS',
            qrString: channelProps.qr_string || null,
            qrImage:
              actions?.desktop_web_checkout_url ||
              actions?.mobile_web_checkout_url ||
              null,
            expiresAt: invoice.payment.dueDate || null,
          }
        } else if (storedMeta?.invoiceUrl) {
          // Fallback to invoice URL if we only have legacy invoice meta
          paymentInstructions = {
            type: 'INVOICE_URL',
            url: storedMeta.invoiceUrl,
            expiresAt: invoice.payment.dueDate || null,
          }
        }
      }

      const responsePayload = {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        subtotal: invoice.subtotal,
        processingFee: invoice.processingFee,
        // promoCodeText: invoice.promoCodeText,
        promoDiscountAmount: invoice.promoDiscountAmount,
        total: invoice.total,
        issuedAt: invoice.issuedAt,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        user: invoice.user,
        booking: invoice.booking,
        classBooking: invoice.classBooking,
        membershipUser: invoice.membershipUser,
        payment: {
          ...invoice.payment,
          method: invoice.payment?.method
            ? {
                ...invoice.payment.method,
                logo: await getFileUrl(invoice.payment.method.logo),
              }
            : null,
        },
        paymentMeta: storedMeta,
        paymentInstructions,
      }

      return c.json(
        ok(responsePayload, 'Invoice detail fetched successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in getInvoiceDetailHandler: ${error}`)
      throw error
    }
  },
)

// POST /invoices/:id/expire
// Manually expire a transaction when the frontend timer finishes
const expireInvoiceSchema = z.object({
  id: z.string(),
})

export const expireInvoiceHandler = factory.createHandlers(
  requireAuth,
  zValidator('param', expireInvoiceSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        throw new Error('Unauthorized')
      }

      const { id } = c.req.valid('param') as { id: string }

      // Find the invoice
      const invoice = await db.invoice.findUnique({
        where: { id },
        include: {
          payment: true,
          booking: true,
          classBooking: true,
          membershipUser: true,
        },
      })

      if (!invoice) {
        return c.json(
          { success: false, message: 'Invoice not found', data: null },
          status.NOT_FOUND,
        )
      }

      // Verify the invoice belongs to the user
      if (invoice.userId !== user.id) {
        return c.json(
          {
            success: false,
            message: 'Unauthorized access to invoice',
            data: null,
          },
          status.FORBIDDEN,
        )
      }

      // Only expire if status is PENDING
      if (invoice.status !== PaymentStatus.PENDING) {
        return c.json(
          {
            success: false,
            message: `Cannot expire invoice with status ${invoice.status}`,
            data: null,
          },
          status.BAD_REQUEST,
        )
      }

      const now = new Date()

      // Perform the expiration in a transaction
      await db.$transaction(async (tx) => {
        // First, release slots if booking exists
        if (invoice.booking) {
          // Collect all slot IDs
          const bookingDetails = await tx.bookingDetail.findMany({
            where: { bookingId: invoice.booking.id },
            select: { slotId: true },
          })
          const courtSlotIds = bookingDetails.map((bd) => bd.slotId)

          const coachDetails = await tx.bookingCoach.findMany({
            where: { bookingId: invoice.booking.id },
            select: { slotId: true },
          })
          const coachSlotIds = coachDetails.map((bc) => bc.slotId)

          const ballboyDetails = await tx.bookingBallboy.findMany({
            where: { bookingId: invoice.booking.id },
            select: { slotId: true },
          })
          const ballboySlotIds = ballboyDetails.map((bb) => bb.slotId)

          const allSlotIds = [
            ...courtSlotIds,
            ...coachSlotIds,
            ...ballboySlotIds,
          ]

          // Release slots immediately BEFORE updating statuses
          if (allSlotIds.length > 0) {
            await tx.slot.updateMany({
              where: { id: { in: allSlotIds } },
              data: { isAvailable: true },
            })
          }
        }

        // Update payment status to EXPIRED if exists
        if (invoice.payment) {
          await tx.payment.update({
            where: { id: invoice.payment.id },
            data: {
              status: PaymentStatus.EXPIRED,
            },
          })
        }

        // Update invoice status to EXPIRED
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: PaymentStatus.EXPIRED,
          },
        })

        // Cancel booking if exists
        if (invoice.booking) {
          await tx.booking.update({
            where: { id: invoice.booking.id },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: 'Payment expired (user timeout)',
              cancelledAt: now,
            },
          })
        }

        // Cancel class booking and restore capacity if exists
        if (invoice.classBooking) {
          await tx.classBooking.update({
            where: { id: invoice.classBooking.id },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: 'Payment expired (user timeout)',
              cancelledAt: now,
            },
          })

          // Restore class capacity
          await tx.class.update({
            where: { id: invoice.classBooking.classId },
            data: {
              remaining: {
                increment: 1,
              },
            },
          })
        }

        // Delete unpaid membership if exists
        if (invoice.membershipUser) {
          await tx.membershipUser.delete({
            where: { id: invoice.membershipUser.id },
          })
        }
      })

      c.var.logger.info(`Invoice ${invoice.id} expired by user ${user.id}`)

      return c.json(
        ok(
          { invoiceId: invoice.id, status: PaymentStatus.EXPIRED },
          'Invoice expired successfully',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in expireInvoiceHandler: ${error}`)
      throw error
    }
  },
)

// Minimum hours before booking starts to allow cancellation
const MIN_CANCELLATION_HOURS = 24

// Schema for cancel booking request (user)
const cancelBookingSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required').optional(),
})

type CancelBookingSchema = z.infer<typeof cancelBookingSchema>

/**
 * Cancel User Booking Handler
 * POST /invoices/:id/cancel-booking
 *
 * Allows users to cancel their own booking with the following validations:
 * 1. User must own the booking
 * 2. Booking must not be already cancelled or completed
 * 3. Must cancel at least 24 hours before the booking starts
 * 4. Refunds payment if already paid
 * 5. Releases all slots (court, coach, ballboy)
 * 6. Restores inventory quantities
 */
export const cancelUserBookingHandler = factory.createHandlers(
  requireAuth,
  zValidator('param', z.object({ id: z.string().min(1) }), validateHook),
  zValidator('json', cancelBookingSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        throw new Error('Unauthorized')
      }

      const { id: invoiceNumber } = c.req.valid('param') as { id: string }
      const { reason } = c.req.valid('json') as CancelBookingSchema

      const result = await db.$transaction(async (tx) => {
        // 1. Fetch invoice with all related data
        const invoice = await tx.invoice.findFirst({
          where: {
            number: invoiceNumber,
            userId: user.id, // Ensure user owns this invoice
          },
          include: {
            booking: {
              include: {
                details: {
                  include: {
                    slot: true,
                    court: true,
                  },
                },
                coaches: {
                  include: {
                    slot: true,
                  },
                },
                ballboys: {
                  include: {
                    slot: true,
                  },
                },
                inventories: {
                  include: {
                    inventory: true,
                  },
                },
              },
            },
            payment: true,
          },
        })

        if (!invoice) {
          throw new NotFoundException('Invoice not found')
        }

        if (!invoice.booking) {
          throw new BadRequestException('No booking found for this invoice')
        }

        const booking = invoice.booking

        // 2. Check if booking can be cancelled
        if (booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException('Booking is already cancelled')
        }

        if (
          booking.status === BookingStatus.CONFIRMED ||
          booking.status === BookingStatus.HOLD
        ) {
          // Check minimal cancellation time (24 hours before booking starts)
          const firstSlot = booking.details[0]?.slot
          if (firstSlot) {
            const bookingStartTime = dayjs(firstSlot.startAt)
            const now = dayjs()
            const hoursUntilBooking = bookingStartTime.diff(now, 'hour')

            if (hoursUntilBooking < MIN_CANCELLATION_HOURS) {
              throw new BadRequestException(
                `Cannot cancel booking less than ${MIN_CANCELLATION_HOURS} hours before the scheduled time. Please contact support for assistance.`,
              )
            }
          }
        }

        // Track counts for response
        const releasedCounts = {
          courtSlots: booking.details.length,
          coachSlots: booking.coaches.length,
          ballboySlots: booking.ballboys.length,
          inventories: booking.inventories.length,
          membershipSessions: 0,
        }

        // 3. Update booking status to CANCELLED
        const updatedBooking = await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: reason || 'Cancelled by user',
          },
        })

        // 4. Release all court slots (make them available again)
        for (const detail of booking.details) {
          await tx.slot.update({
            where: { id: detail.slotId },
            data: {
              isAvailable: true,
            },
          })
        }

        // 5. Release all coach slots
        for (const coach of booking.coaches) {
          await tx.slot.update({
            where: { id: coach.slotId },
            data: {
              isAvailable: true,
            },
          })
        }

        // 6. Release all ballboy slots
        for (const ballboy of booking.ballboys) {
          await tx.slot.update({
            where: { id: ballboy.slotId },
            data: {
              isAvailable: true,
            },
          })
        }

        // 7. Restore inventory quantities
        for (const bookingInventory of booking.inventories) {
          await tx.inventory.update({
            where: { id: bookingInventory.inventoryId },
            data: {
              quantity: {
                increment: bookingInventory.quantity,
              },
            },
          })
        }

        releasedCounts.membershipSessions =
          await restoreMembershipSessionsForCancelledBooking(tx, booking)

        // 8. Update invoice status to CANCELLED
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: PaymentStatus.CANCELLED,
            cancelledAt: new Date(),
          },
        })

        // 9. Handle payment refund
        let refundInfo: unknown = null
        if (invoice.payment && invoice.payment.status === PaymentStatus.PAID) {
          // Mark payment as refund pending
          await tx.payment.update({
            where: { id: invoice.payment.id },
            data: {
              status: PaymentStatus.CANCELLED,
              cancelledAt: new Date(),
            },
          })

          refundInfo = {
            refundPending: true,
            amount: invoice.total,
            message: 'Refund will be processed within 3-5 business days',
          }

          c.var.logger.info(
            `Refund pending for payment ${invoice.payment.id}, amount: ${invoice.total}`,
          )
        }

        return { updatedBooking, releasedCounts, refundInfo }
      })

      c.var.logger.info(
        `User ${user.id} cancelled booking ${result.updatedBooking.id} via invoice ${invoiceNumber}`,
      )

      return c.json(
        ok(
          {
            bookingId: result.updatedBooking.id,
            invoiceNumber: invoiceNumber,
            status: BookingStatus.CANCELLED,
            releasedSlots: {
              courtSlots: result.releasedCounts.courtSlots,
              coachSlots: result.releasedCounts.coachSlots,
              ballboySlots: result.releasedCounts.ballboySlots,
            },
            restoredInventories: result.releasedCounts.inventories,
            restoredMembershipSessions:
              result.releasedCounts.membershipSessions,
            refund: result.refundInfo,
          },
          'Booking cancelled successfully. All resources have been released.',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in cancelUserBookingHandler: ${error}`)
      throw error
    }
  },
)
