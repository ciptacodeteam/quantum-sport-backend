import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { factory } from '@/lib/create-app'
import { requireAuth } from '@/middlewares/auth'
import { validateHook } from '@/helpers/validate-hook'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import {
  clubNowAsWallDate,
  clubWallDayStart,
  clubWallNextDayStart,
  formatClubWallClock,
} from '@/lib/club-time'
import { BadRequestException } from '@/exceptions'
import {
  changeCustomerCourt,
  getCustomerCourtChangeOptions,
} from '@/services/customer-court-change.service'

const params = z.object({ id: z.string().min(1).max(128) })
const scheduleQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((date) => {
      const parsed = new Date(`${date}T00:00:00Z`)
      return (
        !Number.isNaN(+parsed) && parsed.toISOString().slice(0, 10) === date
      )
    }, 'Tanggal tidak valid.'),
  courtSport: z.enum(['TENNIS', 'PADEL']),
})
export const customerCourtChangeSchema = z
  .object({
    sourceSlotId: z.string().min(1).max(128),
    newSlotId: z.string().min(1).max(128),
  })
  .strict()
function branch(c: { get(key: 'branchId'): string | null }) {
  const id = c.get('branchId')
  if (!id) throw new BadRequestException('Pilih cabang terlebih dahulu.')
  return id
}
export const getMyCourtScheduleHandler = factory.createHandlers(
  requireAuth,
  zValidator('query', scheduleQuery, validateHook),
  async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const { date, courtSport } = c.req.valid('query')
    const rows = await db.bookingDetail.findMany({
      where: {
        booking: {
          userId: c.get('user')!.id,
          branchId: branch(c),
          status: 'CONFIRMED',
          purpose: 'REGULAR',
          invoice: { status: 'PAID' },
        },
        slot: {
          type: 'COURT',
          startAt: {
            gte: clubWallDayStart(date),
            lt: clubWallNextDayStart(date),
            gt: clubNowAsWallDate(),
          },
          court: { sport: courtSport },
        },
      },
      select: {
        id: true,
        slotId: true,
        courtId: true,
        slot: {
          select: {
            startAt: true,
            endAt: true,
            court: { select: { id: true, name: true } },
          },
        },
      },
    })
    return c.json(
      ok(
        rows.map((row) => ({
          detailId: row.id,
          slotId: row.slotId,
          courtId: row.slot.court?.id ?? row.courtId,
          courtName: row.slot.court?.name ?? 'Lapangan',
          startAt: formatClubWallClock(row.slot.startAt),
          endAt: formatClubWallClock(row.slot.endAt),
        })),
      ),
    )
  },
)
export const getCourtChangeOptionsHandler = factory.createHandlers(
  requireAuth,
  zValidator('param', params, validateHook),
  async (c) => {
    c.header('Cache-Control', 'private, no-store')
    return c.json(
      ok(
        await getCustomerCourtChangeOptions(
          c.get('user')!.id,
          branch(c),
          c.req.valid('param').id,
        ),
      ),
    )
  },
)
export const changeCustomerCourtHandler = factory.createHandlers(
  requireAuth,
  zValidator('param', params, validateHook),
  zValidator('json', customerCourtChangeSchema, validateHook),
  async (c) =>
    c.json(
      ok(
        await changeCustomerCourt(
          c.get('user')!.id,
          branch(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        'Lapangan berhasil diganti.',
      ),
    ),
)
