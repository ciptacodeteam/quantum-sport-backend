import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { availableCoachesQuerySchema } from '@/lib/validation'
import { toClubWallDate, formatClubWallClock } from '@/lib/club-time'
import { BookingStatus, CourtSport, Role, SlotType } from '@prisma/client'

// GET /ballboys/availability?startAt=YYYY-MM-DDTHH:mm&endAt=YYYY-MM-DDTHH:mm
export const getAvailableBallboyHandler = factory.createHandlers(
  zValidator('query', availableCoachesQuerySchema, validateHook),
  async (c) => {
    try {
      const { startAt, endAt, courtSport } = c.req.valid('query') as {
        startAt: string
        endAt: string
        courtSport?: CourtSport
      }

      const startDateTime = toClubWallDate(startAt)
      const endDateTime = toClubWallDate(endAt)

      if (courtSport && courtSport !== CourtSport.TENNIS) {
        return c.json(ok([]), status.OK)
      }

      // Find all available ballboy slots that overlap with the requested time range
      // A slot overlaps if: slot.startAt < request.endAt AND slot.endAt > request.startAt
      const slots = await db.slot.findMany({
        where: {
          type: SlotType.BALLBOY,
          scheduleClosed: false,
          staff: {
            role: Role.BALLBOY,
            isActive: true,
            ...(!c.req.path?.startsWith('/admin/')
              ? { adminServiceOnly: false }
              : {}),
          },
          AND: [
            {
              startAt: {
                lt: endDateTime,
              },
            },
            {
              endAt: {
                gt: startDateTime,
              },
            },
          ],
          isAvailable: true,
          bookingBallboys: {
            none: {
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
          }, // ensure not already booked (excluding cancelled ballboy bookings)
        },
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
        orderBy: { price: 'asc' },
      })

      const ballboys = slots.map((slot) => ({
        slotId: slot.id,
        ballboy: slot.staff,
        price: slot.price,
        startAt: formatClubWallClock(slot.startAt),
        endAt: formatClubWallClock(slot.endAt),
      }))

      return c.json(ok(ballboys), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAvailableBallboyHandler: ${error}`)
      throw error
    }
  },
)
