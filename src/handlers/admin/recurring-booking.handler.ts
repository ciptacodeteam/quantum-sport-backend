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
