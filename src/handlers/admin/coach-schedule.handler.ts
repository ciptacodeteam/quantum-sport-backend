import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { availableInventoryQuerySchema } from '@/lib/validation'
import { requireCoach } from '@/middlewares/auth'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, SlotType } from '@prisma/client'
import status from 'http-status'
import dayjs from 'dayjs'

// GET /admin/coach/me/schedule?startAt&endAt
// Returns the authenticated coach's slots (booked and available) within an optional range
export const getMyCoachScheduleHandler = factory.createHandlers(
  requireCoach,
  zValidator('query', availableInventoryQuerySchema),
  async (c) => {
    try {
      const admin = c.var.admin
      const { startAt, endAt } = (c.req.valid('query') || {}) as {
        startAt?: string
        endAt?: string
      }

      const where: any = {
        type: SlotType.COACH,
        staffId: admin?.id,
      }

      if (startAt && endAt) {
        where.startAt = { gte: dayjs(startAt).toDate() }
        where.endAt = { lte: dayjs(endAt).toDate() }
      } else {
        // default: upcoming 30 days
        where.startAt = { gte: dayjs().startOf('day').toDate() }
        where.endAt = { lte: dayjs().add(30, 'day').endOf('day').toDate() }
      }

      const slots = await db.slot.findMany({
        where,
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
            include: {
              booking: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      phone: true,
                      email: true,
                    },
                  },
                },
              },
            },
            take: 1,
          },
        },
        orderBy: [{ startAt: 'asc' }],
      })

      const items = slots.map((slot) => {
        const booked = slot.bookingCoaches.length > 0
        const booking = booked ? slot.bookingCoaches[0].booking : null
        return {
          id: slot.id,
          date: dayjs(slot.startAt).format('YYYY-MM-DD'),
          startTime: dayjs(slot.startAt).format('HH:mm'),
          endTime: dayjs(slot.endAt).format('HH:mm'),
          startAt: slot.startAt,
          endAt: slot.endAt,
          price: slot.price,
          isAvailable: slot.isAvailable,
          isBooked: booked,
          booking: booking
            ? {
                id: booking.id,
                user: booking.user,
              }
            : null,
        }
      })

      return c.json(ok(items), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getMyCoachScheduleHandler: ${error}`)
      throw error
    }
  },
)
