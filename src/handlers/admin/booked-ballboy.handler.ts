import { BadRequestException, NotFoundException } from '@/exceptions'
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
import { BookingStatus } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'

// Schema for cancel booking request
const cancelBookingSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required').optional(),
})

type CancelBookingSchema = z.infer<typeof cancelBookingSchema>

// GET /admin/booked-ballboys
// Get all booked ballboys
export const getAllBookedBallboysHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })
      const { where: queryWhere, ...findManyOptions } = queryOptions
      const search = query.search?.trim()
      const where = {
        AND: [
          queryWhere,
          {
            booking: {
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
          },
          search
            ? {
                OR: [
                  {
                    booking: {
                      user: {
                        name: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  },
                  {
                    booking: {
                      user: {
                        email: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  },
                  {
                    booking: {
                      user: {
                        phone: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  },
                  {
                    slot: {
                      staff: {
                        name: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  },
                  {
                    booking: {
                      invoice: {
                        number: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  },
                ],
              }
            : undefined,
        ].filter(Boolean),
      }

      const bookedBallboys = await db.bookingBallboy.findMany({
        ...findManyOptions,
        where,
        include: {
          slot: {
            include: {
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
          courtSlot: {
            include: {
              court: {
                select: {
                  id: true,
                  name: true,
                  sport: true,
                },
              },
            },
          },
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
                },
              },
              details: {
                include: {
                  court: {
                    select: {
                      id: true,
                      name: true,
                      sport: true,
                    },
                  },
                  slot: {
                    select: {
                      id: true,
                      startAt: true,
                      endAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      const formattedBallboys = bookedBallboys.map((ballboy) => ({
        id: ballboy.id,
        staff: ballboy.slot.staff,
        slot: {
          id: ballboy.slot.id,
          startAt: ballboy.slot.startAt,
          endAt: ballboy.slot.endAt,
          date: dayjs(ballboy.slot.startAt).format('YYYY-MM-DD'),
          startTime: dayjs(ballboy.slot.startAt).format('HH:mm'),
          endTime: dayjs(ballboy.slot.endAt).format('HH:mm'),
          dayName: dayjs(ballboy.slot.startAt).format('dddd'),
          duration: dayjs(ballboy.slot.endAt).diff(
            dayjs(ballboy.slot.startAt),
            'hour',
            true,
          ),
          price: ballboy.slot.price,
          isAvailable: ballboy.slot.isAvailable,
        },
        courtSlot: ballboy.courtSlot
          ? {
              id: ballboy.courtSlot.id,
              startAt: ballboy.courtSlot.startAt,
              endAt: ballboy.courtSlot.endAt,
              date: dayjs(ballboy.courtSlot.startAt).format('YYYY-MM-DD'),
              startTime: dayjs(ballboy.courtSlot.startAt).format('HH:mm'),
              endTime: dayjs(ballboy.courtSlot.endAt).format('HH:mm'),
              court: ballboy.courtSlot.court,
            }
          : null,
        booking: {
          id: ballboy.booking.id,
          status: ballboy.booking.status,
          totalPrice: ballboy.booking.totalPrice,
          customer: ballboy.booking.user,
          invoice: ballboy.booking.invoice,
          courtSlots: ballboy.booking.details.map((detail) => ({
            court: detail.court,
            slot: {
              ...detail.slot,
              date: dayjs(detail.slot.startAt).format('YYYY-MM-DD'),
              startTime: dayjs(detail.slot.startAt).format('HH:mm'),
              endTime: dayjs(detail.slot.endAt).format('HH:mm'),
            },
          })),
          createdAt: ballboy.booking.createdAt,
        },
        price: ballboy.price,
        createdAt: ballboy.createdAt,
        updatedAt: ballboy.updatedAt,
      }))

      return c.json(ok(formattedBallboys), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllBookedBallboysHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/booked-ballboys/:id
// Get detailed information about a specific booked ballboy
export const getBookedBallboyDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const ballboy = await db.bookingBallboy.findUnique({
        where: { id },
        include: {
          slot: {
            include: {
              staff: true,
            },
          },
          booking: {
            include: {
              user: true,
              invoice: {
                include: {
                  payment: {
                    include: {
                      method: true,
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
        },
      })

      if (!ballboy) {
        return c.json(ok(null, 'Booked ballboy not found'), status.NOT_FOUND)
      }

      const detailedBallboy = {
        id: ballboy.id,
        staff: ballboy.slot.staff,
        slot: {
          ...ballboy.slot,
          date: dayjs(ballboy.slot.startAt).format('YYYY-MM-DD'),
          startTime: dayjs(ballboy.slot.startAt).format('HH:mm'),
          endTime: dayjs(ballboy.slot.endAt).format('HH:mm'),
          dayName: dayjs(ballboy.slot.startAt).format('dddd'),
          duration: dayjs(ballboy.slot.endAt).diff(
            dayjs(ballboy.slot.startAt),
            'hour',
            true,
          ),
        },
        booking: {
          ...ballboy.booking,
          courtSlots: ballboy.booking.details.map((d) => ({
            court: d.court,
            slot: {
              ...d.slot,
              date: dayjs(d.slot.startAt).format('YYYY-MM-DD'),
              startTime: dayjs(d.slot.startAt).format('HH:mm'),
              endTime: dayjs(d.slot.endAt).format('HH:mm'),
            },
          })),
        },
        price: ballboy.price,
        createdAt: ballboy.createdAt,
        updatedAt: ballboy.updatedAt,
      }

      return c.json(ok(detailedBallboy), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getBookedBallboyDetailHandler: ${error}`)
      throw error
    }
  },
)

// PUT /admin/booked-ballboys/:id/cancel
// Cancel a specific ballboy booking
export const cancelBallboyBookingHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', cancelBookingSchema, validateHook),
  async (c) => {
    try {
      const { id: ballboyBookingId } = c.req.valid('param') as IdSchema
      const { reason } = c.req.valid('json') as CancelBookingSchema

      const result = await db.$transaction(async (tx) => {
        // 1. Fetch the ballboy booking
        const ballboyBooking = await tx.bookingBallboy.findUnique({
          where: { id: ballboyBookingId },
          include: {
            slot: {
              include: {
                staff: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            booking: {
              include: {
                invoice: true,
              },
            },
          },
        })

        if (!ballboyBooking) {
          throw new NotFoundException('Ballboy booking not found')
        }

        // 2. Check if the main booking is already cancelled
        if (ballboyBooking.booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException(
            'Cannot cancel ballboy booking - main booking is already cancelled',
          )
        }

        // 3. Release the ballboy slot
        await tx.slot.update({
          where: { id: ballboyBooking.slotId },
          data: {
            isAvailable: true,
          },
        })

        // 4. Delete the ballboy booking
        await tx.bookingBallboy.delete({
          where: { id: ballboyBookingId },
        })

        // 5. Update the main booking total price (subtract ballboy price)
        const updatedBooking = await tx.booking.update({
          where: { id: ballboyBooking.bookingId },
          data: {
            totalPrice: {
              decrement: ballboyBooking.price,
            },
          },
        })

        // 6. Update invoice if exists
        if (ballboyBooking.booking.invoice) {
          await tx.invoice.update({
            where: { id: ballboyBooking.booking.invoice.id },
            data: {
              subtotal: {
                decrement: ballboyBooking.price,
              },
              total: {
                decrement: ballboyBooking.price,
              },
            },
          })
        }

        return {
          ballboyBooking,
          updatedBooking,
          releasedSlot: ballboyBooking.slot,
        }
      })

      return c.json(
        ok(
          {
            cancelledBallboy: {
              id: result.ballboyBooking.id,
              staff: result.releasedSlot.staff,
              price: result.ballboyBooking.price,
              slot: {
                startAt: result.releasedSlot.startAt,
                endAt: result.releasedSlot.endAt,
                isAvailable: true,
              },
            },
            updatedBooking: {
              id: result.updatedBooking.id,
              totalPrice: result.updatedBooking.totalPrice,
            },
            reason: reason || 'Cancelled by admin',
          },
          'Ballboy booking cancelled successfully. Slot has been released.',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in cancelBallboyBookingHandler: ${error}`)
      throw error
    }
  },
)
