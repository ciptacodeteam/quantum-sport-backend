import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, PaymentStatus, SlotType } from '@prisma/client'
import status from 'http-status'
import dayjs from 'dayjs'
import { z } from 'zod'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { restoreMembershipSessionsForCancelledBooking } from '@/services/membership-booking.service'

// GET /admin/booked-courts
// Get all booked courts with comprehensive booking information
const bookedCourtsQuerySchema = searchQuerySchema.extend({
  source: z
    .enum(['cashier', 'online'])
    .optional()
    .describe('Filter by booking source: cashier or online'),
})

export const getAllBookedCourtsHandler = factory.createHandlers(
  zValidator('query', bookedCourtsQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as any
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      // Add source filter if provided
      let where = queryOptions.where || {}
      if (query.source) {
        if (query.source === 'cashier') {
          where = { ...where, booking: { cashierId: { not: null } } }
        } else if (query.source === 'online') {
          where = { ...where, booking: { cashierId: null } }
        }
      }

      // Fetch all booking details with court information
      const bookingDetails = await db.bookingDetail.findMany({
        ...queryOptions,
        where,
        include: {
          booking: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  image: true,
                },
              },
              invoice: {
                select: {
                  id: true,
                  number: true,
                  status: true,
                  total: true,
                  subtotal: true,
                  processingFee: true,
                  paidAt: true,
                },
              },
              coaches: {
                include: {
                  slot: {
                    select: {
                      startAt: true,
                      endAt: true,
                      staff: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                  },
                  bookingCoachType: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
              ballboys: {
                include: {
                  slot: {
                    select: {
                      startAt: true,
                      endAt: true,
                      staff: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                  },
                },
              },
              inventories: {
                include: {
                  inventory: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
          court: {
            select: {
              id: true,
              name: true,
              description: true,
              image: true,
              isActive: true,
            },
          },
          slot: {
            select: {
              id: true,
              startAt: true,
              endAt: true,
              price: true,
              isAvailable: true,
            },
          },
        },
      })

      // Transform the data for better readability
      const bookedCourts = bookingDetails.map((detail) => ({
        bookingDetailId: detail.id,
        court: {
          id: detail.court?.id || null,
          name: detail.court?.name || 'Unknown Court',
          description: detail.court?.description,
          image: detail.court?.image,
          isActive: detail.court?.isActive,
        },
        slot: {
          id: detail.slot.id,
          startAt: detail.slot.startAt,
          endAt: detail.slot.endAt,
          date: dayjs(detail.slot.startAt).format('YYYY-MM-DD'),
          startTime: dayjs(detail.slot.startAt).format('HH:mm'),
          endTime: dayjs(detail.slot.endAt).format('HH:mm'),
          duration: dayjs(detail.slot.endAt).diff(
            dayjs(detail.slot.startAt),
            'hour',
            true,
          ),
          price: detail.slot.price,
          isAvailable: detail.slot.isAvailable,
        },
        booking: {
          id: detail.booking.id,
          status: detail.booking.status,
          totalPrice: detail.booking.totalPrice,
          processingFee: detail.booking.processingFee,
          createdAt: detail.booking.createdAt,
          updatedAt: detail.booking.updatedAt,
          holdExpiresAt: detail.booking.holdExpiresAt,
          cancelledAt: detail.booking.cancelledAt,
          cancellationReason: detail.booking.cancellationReason,
        },
        customer: {
          id: detail.booking.user.id,
          name: detail.booking.user.name,
          email: detail.booking.user.email,
          phone: detail.booking.user.phone,
          image: detail.booking.user.image,
        },
        invoice: detail.booking.invoice
          ? {
              id: detail.booking.invoice.id,
              number: detail.booking.invoice.number,
              status: detail.booking.invoice.status,
              total: detail.booking.invoice.total,
              subtotal: detail.booking.invoice.subtotal,
              processingFee: detail.booking.invoice.processingFee,
              paidAt: detail.booking.invoice.paidAt,
            }
          : null,
        coaches: detail.booking.coaches.map((coach) => ({
          staffId: coach.slot.staff?.id,
          staffName: coach.slot.staff?.name,
          coachType: coach.bookingCoachType.name,
          startAt: coach.slot.startAt,
          endAt: coach.slot.endAt,
        })),
        ballboys: detail.booking.ballboys.map((ballboy) => ({
          staffId: ballboy.slot.staff?.id,
          staffName: ballboy.slot.staff?.name,
          startAt: ballboy.slot.startAt,
          endAt: ballboy.slot.endAt,
        })),
        inventories: detail.booking.inventories.map((inv) => ({
          id: inv.inventory.id,
          name: inv.inventory.name,
          quantity: inv.quantity,
          price: inv.price,
        })),
        price: detail.price,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      }))

      return c.json(ok(bookedCourts), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllBookedCourtsHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/booked-courts/:id
// Get detailed information about a specific booked court
export const getBookedCourtDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const bookingDetail = await db.bookingDetail.findUnique({
        where: { id },
        include: {
          booking: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  image: true,
                  emailVerified: true,
                  phoneVerified: true,
                  banned: true,
                  banReason: true,
                  banExpires: true,
                },
              },
              invoice: {
                include: {
                  payment: {
                    include: {
                      method: {
                        select: {
                          id: true,
                          name: true,
                          logo: true,
                          fees: true,
                          percentage: true,
                        },
                      },
                    },
                  },
                },
              },
              coaches: {
                include: {
                  slot: {
                    select: {
                      id: true,
                      startAt: true,
                      endAt: true,
                      price: true,
                      staff: {
                        select: {
                          id: true,
                          name: true,
                          email: true,
                          phone: true,
                          image: true,
                          role: true,
                        },
                      },
                    },
                  },
                  bookingCoachType: {
                    select: {
                      id: true,
                      name: true,
                      description: true,
                    },
                  },
                },
              },
              ballboys: {
                include: {
                  slot: {
                    select: {
                      id: true,
                      startAt: true,
                      endAt: true,
                      price: true,
                      staff: {
                        select: {
                          id: true,
                          name: true,
                          email: true,
                          phone: true,
                          image: true,
                        },
                      },
                    },
                  },
                },
              },
              inventories: {
                include: {
                  inventory: {
                    select: {
                      id: true,
                      name: true,
                      description: true,
                      quantity: true,
                      price: true,
                    },
                  },
                },
              },
              details: {
                include: {
                  court: true,
                  slot: true,
                },
              },
            },
          },
          court: true,
          slot: true,
        },
      })

      if (!bookingDetail) {
        return c.json(ok(null, 'Booked court not found'), status.NOT_FOUND)
      }

      const detailedBookedCourt = {
        bookingDetailId: bookingDetail.id,
        court: bookingDetail.court,
        slot: {
          ...bookingDetail.slot,
          date: dayjs(bookingDetail.slot.startAt).format('YYYY-MM-DD'),
          startTime: dayjs(bookingDetail.slot.startAt).format('HH:mm'),
          endTime: dayjs(bookingDetail.slot.endAt).format('HH:mm'),
          duration: dayjs(bookingDetail.slot.endAt).diff(
            dayjs(bookingDetail.slot.startAt),
            'hour',
            true,
          ),
          dayName: dayjs(bookingDetail.slot.startAt).format('dddd'),
        },
        booking: {
          id: bookingDetail.booking.id,
          status: bookingDetail.booking.status,
          totalPrice: bookingDetail.booking.totalPrice,
          processingFee: bookingDetail.booking.processingFee,
          createdAt: bookingDetail.booking.createdAt,
          updatedAt: bookingDetail.booking.updatedAt,
          holdExpiresAt: bookingDetail.booking.holdExpiresAt,
          cancelledAt: bookingDetail.booking.cancelledAt,
          cancellationReason: bookingDetail.booking.cancellationReason,
          allCourtSlots: bookingDetail.booking.details.map((d) => ({
            court: d.court,
            slot: {
              ...d.slot,
              date: dayjs(d.slot.startAt).format('YYYY-MM-DD'),
              startTime: dayjs(d.slot.startAt).format('HH:mm'),
              endTime: dayjs(d.slot.endAt).format('HH:mm'),
            },
            price: d.price,
          })),
        },
        customer: bookingDetail.booking.user,
        invoice: bookingDetail.booking.invoice,
        coaches: bookingDetail.booking.coaches.map((coach) => ({
          id: coach.id,
          staff: coach.slot.staff,
          coachType: coach.bookingCoachType,
          slot: {
            ...coach.slot,
            date: dayjs(coach.slot.startAt).format('YYYY-MM-DD'),
            startTime: dayjs(coach.slot.startAt).format('HH:mm'),
            endTime: dayjs(coach.slot.endAt).format('HH:mm'),
          },
          price: coach.price,
        })),
        ballboys: bookingDetail.booking.ballboys.map((ballboy) => ({
          id: ballboy.id,
          staff: ballboy.slot.staff,
          slot: {
            ...ballboy.slot,
            date: dayjs(ballboy.slot.startAt).format('YYYY-MM-DD'),
            startTime: dayjs(ballboy.slot.startAt).format('HH:mm'),
            endTime: dayjs(ballboy.slot.endAt).format('HH:mm'),
          },
          price: ballboy.price,
        })),
        inventories: bookingDetail.booking.inventories.map((inv) => ({
          id: inv.id,
          inventory: inv.inventory,
          quantity: inv.quantity,
          price: inv.price,
        })),
        price: bookingDetail.price,
        createdAt: bookingDetail.createdAt,
        updatedAt: bookingDetail.updatedAt,
      }

      return c.json(ok(detailedBookedCourt), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getBookedCourtDetailHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/booked-courts/summary
// Get summary statistics of all booked courts
export const getBookedCourtsSummaryHandler = factory.createHandlers(
  async (c) => {
    try {
      // Get total counts
      const totalBookedCourts = await db.bookingDetail.count()

      const bookingsByStatus = await db.booking.groupBy({
        by: ['status'],
        _count: {
          id: true,
        },
      })

      // Get court usage statistics
      const courtUsage = await db.bookingDetail.groupBy({
        by: ['courtId'],
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: 'desc',
          },
        },
        take: 10,
      })

      // Fetch court details for top 10
      const courtIds = courtUsage
        .map((u) => u.courtId)
        .filter(Boolean) as string[]
      const courts = await db.court.findMany({
        where: {
          id: {
            in: courtIds,
          },
        },
        select: {
          id: true,
          name: true,
          image: true,
        },
      })

      const topCourts = courtUsage.map((usage) => {
        const court = courts.find((c) => c.id === usage.courtId)
        return {
          courtId: usage.courtId,
          courtName: court?.name || 'Unknown Court',
          courtImage: court?.image,
          bookingCount: usage._count.id,
        }
      })

      // Get recent bookings (last 10)
      const recentBookings = await db.bookingDetail.findMany({
        take: 10,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          court: {
            select: {
              id: true,
              name: true,
            },
          },
          slot: {
            select: {
              startAt: true,
              endAt: true,
            },
          },
          booking: {
            select: {
              status: true,
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      })

      // Get booking status breakdown
      const statusBreakdown = bookingsByStatus.reduce(
        (acc, item) => {
          acc[item.status] = item._count.id
          return acc
        },
        {} as Record<string, number>,
      )

      // Calculate total revenue from confirmed bookings
      const confirmedBookings = await db.booking.findMany({
        where: {
          status: BookingStatus.CONFIRMED,
        },
        select: {
          totalPrice: true,
          processingFee: true,
        },
      })

      const totalRevenue = confirmedBookings.reduce(
        (sum, booking) => sum + booking.totalPrice + booking.processingFee,
        0,
      )

      // Get upcoming bookings (future slots)
      const upcomingBookings = await db.bookingDetail.count({
        where: {
          slot: {
            startAt: {
              gte: new Date(),
            },
          },
          booking: {
            status: {
              in: [BookingStatus.CONFIRMED, BookingStatus.HOLD],
            },
          },
        },
      })

      // Get past bookings
      const pastBookings = await db.bookingDetail.count({
        where: {
          slot: {
            endAt: {
              lt: new Date(),
            },
          },
          booking: {
            status: BookingStatus.CONFIRMED,
          },
        },
      })

      return c.json(
        ok({
          overview: {
            totalBookedCourts,
            upcomingBookings,
            pastBookings,
            totalRevenue,
          },
          statusBreakdown,
          topCourts,
          recentBookings: recentBookings.map((booking) => ({
            id: booking.id,
            courtName: booking.court?.name || 'Unknown Court',
            customerName: booking.booking.user.name,
            date: dayjs(booking.slot.startAt).format('YYYY-MM-DD'),
            startTime: dayjs(booking.slot.startAt).format('HH:mm'),
            endTime: dayjs(booking.slot.endAt).format('HH:mm'),
            status: booking.booking.status,
            createdAt: booking.createdAt,
          })),
        }),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in getBookedCourtsSummaryHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/booked-courts/by-court/:courtId
// Get all bookings for a specific court
export const getBookingsByCourtHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const { id: courtId } = c.req.valid('param') as IdSchema
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      const court = await db.court.findUnique({
        where: { id: courtId },
        select: {
          id: true,
          name: true,
          description: true,
          image: true,
          isActive: true,
        },
      })

      if (!court) {
        return c.json(ok(null, 'Court not found'), status.NOT_FOUND)
      }

      const bookings = await db.bookingDetail.findMany({
        ...queryOptions,
        where: {
          courtId,
        },
        include: {
          slot: true,
          booking: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
              invoice: {
                select: {
                  number: true,
                  status: true,
                  total: true,
                },
              },
            },
          },
        },
      })

      return c.json(
        ok({
          court,
          bookings: bookings.map((booking) => ({
            id: booking.id,
            slot: {
              ...booking.slot,
              date: dayjs(booking.slot.startAt).format('YYYY-MM-DD'),
              startTime: dayjs(booking.slot.startAt).format('HH:mm'),
              endTime: dayjs(booking.slot.endAt).format('HH:mm'),
              dayName: dayjs(booking.slot.startAt).format('dddd'),
            },
            booking: {
              id: booking.booking.id,
              status: booking.booking.status,
              totalPrice: booking.booking.totalPrice,
              createdAt: booking.booking.createdAt,
            },
            customer: booking.booking.user,
            invoice: booking.booking.invoice,
            price: booking.price,
            createdAt: booking.createdAt,
          })),
          totalBookings: bookings.length,
        }),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in getBookingsByCourtHandler: ${error}`)
      throw error
    }
  },
)

const MIN_RESCHEDULE_DAYS = 3

// Schema for cancel booking request
const cancelBookingSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required').optional(),
})

type CancelBookingSchema = z.infer<typeof cancelBookingSchema>

const rescheduleCourtSchema = z.object({
  newSlotId: z.string().min(1, 'Target slot is required'),
})

type RescheduleCourtSchema = z.infer<typeof rescheduleCourtSchema>

// PUT /admin/booked-courts/:id/cancel
// Cancel a specific booking and update all related records
export const cancelBookingHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', cancelBookingSchema, validateHook),
  async (c) => {
    try {
      const { id: bookingId } = c.req.valid('param') as IdSchema
      const { reason } = c.req.valid('json') as CancelBookingSchema

      const result = await db.$transaction(async (tx) => {
        // 1. Fetch the booking with all related data
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            details: {
              include: {
                slot: true,
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
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!booking) {
          throw new NotFoundException('Booking not found')
        }

        // 2. Check if booking can be cancelled
        if (booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException('Booking is already cancelled')
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
          where: { id: bookingId },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: reason || 'Cancelled by admin',
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

        await tx.bookingCoach.updateMany({
          where: {
            bookingId,
            status: {
              not: BookingStatus.CANCELLED,
            },
          },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: reason || 'Cancelled by admin',
          },
        })

        // 6. Release all ballboy slots
        for (const ballboy of booking.ballboys) {
          await tx.slot.update({
            where: { id: ballboy.slotId },
            data: {
              isAvailable: true,
            },
          })
        }

        await tx.bookingBallboy.updateMany({
          where: {
            bookingId,
            status: {
              not: BookingStatus.CANCELLED,
            },
          },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: reason || 'Cancelled by admin',
          },
        })

        // 7. Restore inventory quantities
        for (const bookingInventory of booking.inventories.filter(
          (inventory) => !inventory.returnedAt,
        )) {
          await tx.inventory.update({
            where: { id: bookingInventory.inventoryId },
            data: {
              quantity: {
                increment: bookingInventory.quantity,
              },
            },
          })
          await tx.bookingInventory.update({
            where: { id: bookingInventory.id },
            data: { returnedAt: new Date() },
          })
        }

        releasedCounts.membershipSessions =
          await restoreMembershipSessionsForCancelledBooking(tx, booking)

        // 8. Update invoice status to CANCELLED
        if (booking.invoice) {
          await tx.invoice.update({
            where: { id: booking.invoice.id },
            data: {
              status: PaymentStatus.CANCELLED,
              cancelledAt: new Date(),
            },
          })

          // 9. Update payment status to CANCELLED (if exists)
          if (booking.invoice.payment) {
            await tx.payment.update({
              where: { id: booking.invoice.payment.id },
              data: {
                status: PaymentStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            })
          }
        }

        return { updatedBooking, releasedCounts }
      })

      // Fetch the updated booking with all details for response
      const cancelledBooking = await db.booking.findUnique({
        where: { id: bookingId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          details: {
            include: {
              court: {
                select: {
                  id: true,
                  name: true,
                },
              },
              slot: {
                select: {
                  startAt: true,
                  endAt: true,
                  isAvailable: true,
                },
              },
            },
          },
          invoice: {
            select: {
              id: true,
              number: true,
              status: true,
              total: true,
            },
          },
        },
      })

      return c.json(
        ok(
          {
            booking: cancelledBooking,
            releasedSlots: {
              courtSlots: result.releasedCounts.courtSlots,
              coachSlots: result.releasedCounts.coachSlots,
              ballboySlots: result.releasedCounts.ballboySlots,
            },
            restoredInventories: result.releasedCounts.inventories,
            restoredMembershipSessions:
              result.releasedCounts.membershipSessions,
          },
          'Booking cancelled successfully. All related records have been updated.',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in cancelBookingHandler: ${error}`)
      throw error
    }
  },
)

// PUT /admin/booked-courts/:id/reschedule
// Allow admin to move a court booking to a different slot
export const rescheduleCourtBookingHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', rescheduleCourtSchema, validateHook),
  async (c) => {
    try {
      const { id: bookingDetailId } = c.req.valid('param') as IdSchema
      const { newSlotId } = c.req.valid('json') as RescheduleCourtSchema

      const result = await db.$transaction(async (tx) => {
        const bookingDetail = await tx.bookingDetail.findUnique({
          where: { id: bookingDetailId },
          include: {
            slot: true,
            court: true,
            booking: {
              include: {
                invoice: true,
                coaches: {
                  include: {
                    slot: true,
                  },
                },
              },
            },
          },
        })

        if (!bookingDetail) {
          throw new NotFoundException('Booked court not found')
        }

        if (bookingDetail.booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException('Cannot reschedule a cancelled booking')
        }

        const hoursUntilStart = dayjs(bookingDetail.slot.startAt).diff(
          dayjs(),
          'hour',
          true,
        )

        if (hoursUntilStart < MIN_RESCHEDULE_DAYS * 24) {
          throw new BadRequestException(
            `Reschedule is only allowed at least ${MIN_RESCHEDULE_DAYS} days before play date`,
          )
        }

        if (bookingDetail.slotId === newSlotId) {
          throw new BadRequestException(
            'Selected slot is the same as the current booking',
          )
        }

        const newSlot = await tx.slot.findUnique({
          where: { id: newSlotId },
          include: {
            court: true,
          },
        })

        if (!newSlot || newSlot.type !== SlotType.COURT) {
          throw new NotFoundException('Target court slot not found')
        }

        if (!newSlot.isAvailable) {
          throw new BadRequestException('Selected slot is no longer available')
        }

        if (!newSlot.courtId) {
          throw new BadRequestException(
            'Selected slot must be associated with a court',
          )
        }

        if (dayjs(newSlot.startAt).isBefore(dayjs())) {
          throw new BadRequestException('Selected slot time has already passed')
        }

        // Before actually moving the court slot, check if there are coach slots
        // at the same time that also need to be moved. If any corresponding
        // coach slot is not available at the new time, block the reschedule.
        const relatedCoaches = bookingDetail.booking.coaches.filter((coach) => {
          return (
            dayjs(coach.slot.startAt).isSame(bookingDetail.slot.startAt) &&
            dayjs(coach.slot.endAt).isSame(bookingDetail.slot.endAt)
          )
        })

        const coachSlotReplacements: {
          bookingCoachId: string
          oldSlotId: string
          newSlotId: string
        }[] = []

        for (const coach of relatedCoaches) {
          const coachSlot = await tx.slot.findFirst({
            where: {
              type: SlotType.COACH,
              staffId: coach.slot.staffId,
              startAt: newSlot.startAt,
              endAt: newSlot.endAt,
              isAvailable: true,
            },
            include: {
              bookingCoaches: {
                where: {
                  status: {
                    not: BookingStatus.CANCELLED,
                  },
                  booking: {
                    status: {
                      not: BookingStatus.CANCELLED,
                    },
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })

          if (!coachSlot || coachSlot.bookingCoaches.length > 0) {
            throw new BadRequestException(
              'Selected slot is not available for the assigned coach at the new time',
            )
          }

          coachSlotReplacements.push({
            bookingCoachId: coach.id,
            oldSlotId: coach.slotId,
            newSlotId: coachSlot.id,
          })
        }

        // Release old court slot and lock new court slot
        await tx.slot.update({
          where: { id: bookingDetail.slotId },
          data: {
            isAvailable: true,
          },
        })

        await tx.slot.update({
          where: { id: newSlot.id },
          data: {
            isAvailable: false,
          },
        })

        const updatedDetail = await tx.bookingDetail.update({
          where: { id: bookingDetailId },
          data: {
            slotId: newSlot.id,
            price: newSlot.price,
            courtId: newSlot.courtId,
          },
          include: {
            slot: true,
            court: true,
          },
        })

        // Apply coach slot moves (if any)
        for (const item of coachSlotReplacements) {
          // release old coach slot
          await tx.slot.update({
            where: { id: item.oldSlotId },
            data: {
              isAvailable: true,
            },
          })

          // lock new coach slot
          await tx.slot.update({
            where: { id: item.newSlotId },
            data: {
              isAvailable: false,
            },
          })

          // move booking coach to new slot
          await tx.bookingCoach.update({
            where: { id: item.bookingCoachId },
            data: {
              slotId: item.newSlotId,
            },
          })
        }

        const priceDifference = newSlot.price - bookingDetail.price
        let updatedBooking =
          bookingDetail.booking as typeof bookingDetail.booking & {
            invoice: typeof bookingDetail.booking.invoice
            coaches: typeof bookingDetail.booking.coaches
          }

        if (priceDifference !== 0) {
          updatedBooking = (await tx.booking.update({
            where: { id: bookingDetail.bookingId },
            data: {
              totalPrice: {
                increment: priceDifference,
              },
            },
            include: {
              invoice: true,
              coaches: {
                include: {
                  slot: true,
                },
              },
            },
          })) as typeof updatedBooking

          if (bookingDetail.booking.invoice) {
            await tx.invoice.update({
              where: { id: bookingDetail.booking.invoice.id },
              data: {
                subtotal: {
                  increment: priceDifference,
                },
                total: {
                  increment: priceDifference,
                },
              },
            })
          }
        }

        return {
          updatedDetail,
          updatedBooking,
          previousSlot: bookingDetail.slot,
          priceDifference,
        }
      })

      return c.json(
        ok(
          {
            bookingDetail: {
              id: result.updatedDetail.id,
              price: result.updatedDetail.price,
              slot: result.updatedDetail.slot,
              court: result.updatedDetail.court,
            },
            updatedBooking: {
              id: result.updatedBooking.id,
              totalPrice: result.updatedBooking.totalPrice,
            },
            previousSlot: result.previousSlot,
            priceDifference: result.priceDifference,
          },
          'Court booking rescheduled successfully.',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in rescheduleCourtBookingHandler: ${error}`)
      throw error
    }
  },
)
