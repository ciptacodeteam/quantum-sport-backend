import { recurringBookingInputSchema } from '@/lib/recurring-booking'
import {
  recurringSource,
  planRecurringSessions,
} from '@/services/recurring-plan.service'
import dayjs from '@/lib/club-time'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { idSchema } from '@/lib/validation'
import { validateHook } from '@/helpers/validate-hook'
import { zValidator } from '@hono/zod-validator'
import { NotFoundException } from '@/exceptions'

export const listRecurringBookingsHandler = factory.createHandlers(
  async (c) => {
    const rules = await db.recurringBooking.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        occurrences: {
          where: { bookingId: null },
          orderBy: { date: 'desc' },
          take: 5,
        },
      },
    })
    return c.json(ok(rules))
  },
)

export const stopRecurringBookingHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await db.$transaction(async (tx) => {
      const rule = await tx.recurringBooking.findUnique({ where: { id } })
      if (!rule)
        throw new NotFoundException('Aturan booking rutin tidak ditemukan.')
      // UPDATE waits for any in-flight generator before committing the stop.
      return tx.recurringBooking.update({
        where: { id },
        data: { isActive: false, stoppedAt: new Date() },
      })
    })
    return c.json(
      ok(
        result,
        'Perpanjangan dihentikan. Booking yang sudah dibuat tetap berlaku.',
      ),
    )
  },
)

export const previewRecurringBookingHandler = factory.createHandlers(
  zValidator('json', recurringBookingInputSchema, validateHook),
  async (c) => {
    const input = c.req.valid('json'),
      now = new Date()
    const { courts, templates, horizon } = await recurringSource(db, input, now)
    const plan = await planRecurringSessions(
      db,
      courts,
      templates,
      input.startDate,
      horizon,
      input.weekdays,
      now,
    )
    return c.json(
      ok({
        through: horizon,
        sessions: plan.map((session) => ({
          date: session.date,
          conflicts: session.conflicts,
          items: session.slots.map((slot) => ({
            slotId: slot.id ?? `planned:${slot.courtId}:${+slot.startAt}`,
            courtId: slot.courtId,
            courtName: courts.find((c) => c.id === slot.courtId)!.name,
            sport: courts.find((c) => c.id === slot.courtId)!.sport,
            date: session.date,
            timeSlot: dayjs(slot.startAt).format('HH:mm'),
            endTime: dayjs(slot.endAt).format('HH:mm'),
            startAt: slot.startAt.toISOString(),
            endAt: slot.endAt.toISOString(),
            price: slot.discountPrice > 0 ? slot.discountPrice : slot.price,
            normalPrice: slot.price,
            discountPrice: slot.discountPrice,
          })),
        })),
      }),
    )
  },
)
