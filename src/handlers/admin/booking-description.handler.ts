import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { HTTPException } from 'hono/http-exception'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { validateHook } from '@/helpers/validate-hook'
import { requireAnyAdminRole } from '@/middlewares/auth'
import { BadRequestException, NotFoundException } from '@/exceptions'

// Audit lines share adminNote with the editable description. Preserve their raw
// representation, including old formats, so editing cannot erase booking history.
const isHistory = (line: string) =>
  /^\[(COURT_CHANGE|COURT_RESCHEDULE)\] /.test(line) ||
  /^\[[^\]]+\] Admin \S+ pindah lapangan: /.test(line)

export const updateBookingDescriptionHandler = factory.createHandlers(
  requireAnyAdminRole(['ADMIN', 'CASHIER']),
  zValidator('param', z.object({ id: z.string().min(1) }), validateHook),
  zValidator(
    'json',
    z
      .object({
        description: z.string().trim().max(1000),
        expectedAdminNote: z.string().nullable(),
      })
      .strict(),
    validateHook,
  ),
  async (c) => {
    const { id } = c.req.valid('param')
    const { description, expectedAdminNote } = c.req.valid('json')
    if (description.split('\n').some(isHistory))
      throw new BadRequestException(
        'Description tidak boleh memuat penanda riwayat sistem.',
      )
    const booking = await db.booking.findFirst({
      where: { id },
      select: { id: true, adminNote: true },
    })
    if (!booking) throw new NotFoundException('Pemesanan tidak ditemukan.')
    const conflict = () =>
      new HTTPException(409, {
        message:
          'Description atau riwayat pemesanan sudah berubah. Muat ulang detail sebelum mengedit lagi.',
      })
    if (booking.adminNote !== expectedAdminNote) throw conflict()
    const history = (booking.adminNote ?? '').split('\n').filter(isHistory)
    const adminNote =
      [description, ...history].filter(Boolean).join('\n') || null
    // Compare-and-set also protects a reschedule or another edit after the read.
    const changed = await db.booking.updateMany({
      where: { id, adminNote: expectedAdminNote },
      data: { adminNote },
    })
    if (changed.count !== 1) throw conflict()
    return c.json(ok({ id, adminNote }, 'Description berhasil diperbarui.'))
  },
)
