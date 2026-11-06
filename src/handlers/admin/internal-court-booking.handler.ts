import { zValidator } from '@hono/zod-validator'
import { factory } from '@/lib/create-app'
import { validateHook } from '@/helpers/validate-hook'
import { UnauthorizedException } from '@/exceptions'
import { ok } from '@/lib/response'
import {
  createInternalCourtBooking,
  internalCourtBookingSchema,
} from '@/services/internal-court-booking.service'

export const createInternalCourtBookingHandler = factory.createHandlers(
  zValidator('json', internalCourtBookingSchema, validateHook),
  async (c) => {
    const admin = c.get('admin')
    if (!admin) throw new UnauthorizedException()
    const booking = await createInternalCourtBooking(
      c.req.valid('json'),
      admin.id,
    )
    return c.json(ok(booking, 'Booking lapangan berhasil disimpan.', 201), 201)
  },
)
