import { filterAvailableBallboySlots } from '@/services/ballboy-availability.service'
import { ensureBallboySchedules } from '@/services/ballboy-schedule.service'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { availableCoachesQuerySchema } from '@/lib/validation'
import { toClubWallDate, formatClubWallClock } from '@/lib/club-time'
import { Role, SlotType } from '@prisma/client'

// GET /ballboys/availability?startAt=YYYY-MM-DDTHH:mm&endAt=YYYY-MM-DDTHH:mm
export const getAvailableBallboyHandler = factory.createHandlers(
  zValidator('query', availableCoachesQuerySchema, validateHook),
  async (c) => {
    try {
      const { startAt, endAt } = c.req.valid('query') as {
        startAt: string
        endAt: string
      }

      const startDateTime = toClubWallDate(startAt)
      const endDateTime = toClubWallDate(endAt)

      await ensureBallboySchedules()

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
              coachType: true,
            },
          },
        },
        orderBy: { price: 'asc' },
      })

      // Keep booked/manual-unavailable hours in the timetable, but never closed hours.
      const hours = [
        ...new Set(
          slots
            .filter(
              (slot) =>
                slot.startAt >= startDateTime &&
                slot.endAt <= endDateTime &&
                slot.startAt.getUTCMinutes() === 0 &&
                +slot.endAt - +slot.startAt === 3600000,
            )
            .map((slot) => formatClubWallClock(slot.startAt, 'HH:mm')),
        ),
      ].sort()
      const available = await filterAvailableBallboySlots(
        slots.filter((slot) => slot.isAvailable),
      )
      const ballboys = available.map((slot) => ({
        slotId: slot.id,
        ballboy: slot.staff,
        price: slot.price,
        startAt: formatClubWallClock(slot.startAt),
        endAt: formatClubWallClock(slot.endAt),
      }))

      return c.json({ ...ok(ballboys), hours }, status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAvailableBallboyHandler: ${error}`)
      throw error
    }
  },
)

// Public booking catalog: keep unavailable ballboys visible in the timetable.
export const getBallboysHandler = factory.createHandlers(async (c) => {
  const ballboys = await db.staff.findMany({
    where: {
      role: Role.BALLBOY,
      isActive: true,
      adminServiceOnly: false,
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return c.json(ok(ballboys), status.OK)
})
