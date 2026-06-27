import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { availableCoachesQuerySchema } from '@/lib/validation'
import dayjs from 'dayjs'
import { BookingStatus, SlotType } from '@prisma/client'
import { getFileUrl } from '@/services/upload.service'

// GET /coaches
export const getCoachesHandler = factory.createHandlers(async (c) => {
  try {
    const coaches = await db.staff.findMany({
      where: {
        role: 'COACH',
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        image: true,
        coachType: true,
        coachProfile: true,
      },
      orderBy: [{ joinedAt: 'asc' }, { name: 'asc' }],
    })

    const formattedCoaches = await Promise.all(
      coaches.map(async (coach) => ({
        ...coach,
        image: coach.image ? await getFileUrl(coach.image) : null,
        achievements:
          coach.coachProfile
            ?.split('\n')
            .map((item) => item.trim())
            .filter(Boolean) ?? [],
      })),
    )

    return c.json(ok(formattedCoaches), status.OK)
  } catch (error) {
    c.var.logger.fatal(`Error in getCoachesHandler: ${error}`)
    throw error
  }
})

// GET /coaches/availability?startAt=YYYY-MM-DDTHH:mm&endAt=YYYY-MM-DDTHH:mm
export const getAvailableCoachesHandler = factory.createHandlers(
  zValidator('query', availableCoachesQuerySchema, validateHook),
  async (c) => {
    try {
      const { startAt, endAt } = c.req.valid('query') as {
        startAt: string
        endAt: string
      }

      const startDateTime = dayjs(startAt).toDate()
      const endDateTime = dayjs(endAt).toDate()

      // Find all available coach slots that overlap with the requested time range
      // A slot overlaps if: slot.startAt < request.endAt AND slot.endAt > request.startAt
      const slots = await db.slot.findMany({
        where: {
          type: SlotType.COACH,
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
          bookingCoaches: {
            none: {
              booking: {
                status: {
                  not: BookingStatus.CANCELLED,
                },
              },
            },
          }, // ensure not already booked (excluding cancelled bookings)
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

      // Format the response
      const coaches = slots.map((slot) => ({
        slotId: slot.id,
        coach: slot.staff,
        price: slot.price,
        startAt: slot.startAt,
        endAt: slot.endAt,
      }))

      return c.json(ok(coaches), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAvailableCoachesHandler: ${error}`)
      throw error
    }
  },
)
