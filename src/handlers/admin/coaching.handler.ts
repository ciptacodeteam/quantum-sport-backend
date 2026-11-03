import {
  bookingDateRangeFields,
  validBookingDateRange,
  bookingDateRangeError,
  playingDateRange,
} from '@/lib/booking-date-filter'
import { previewCoachCancellation } from '@/services/coach-cancellation.service'
import { randomUUID } from 'node:crypto'
import {
  availableCoachReplacements,
  replaceBookedCoach,
} from '@/services/coach-replacement.service'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { BadRequestException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { hashPassword } from '@/lib/password'
import { formatPhone } from '@/lib/utils'
import { assertCourtSportAtBranch } from '@/lib/court-branch-policy'
import {
  coachingProfileSchema,
  coachingScheduleSchema,
} from '@/lib/coaching-policy'
import {
  coachingAvailability,
  coachingSchedule,
  coachingSelect,
  getCoachingPerson,
  saveCoachingSchedule,
  attachCoachingService,
} from '@/services/coaching.service'
import { formatClubWallClock, toClubWallDate } from '@/lib/club-time'

const wallDatetime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/)
  .refine((v) => {
    const parsed = toClubWallDate(v)
    return (
      Number.isFinite(+parsed) &&
      parsed.toISOString().slice(0, 19) === v.replace(' ', 'T')
    )
  }, 'Waktu tidak valid.')
const params = z.object({ id: z.string().min(1) })
const dateRange = z
  .object({
    fromDate: coachingScheduleSchema.shape.fromDate,
    toDate: coachingScheduleSchema.shape.toDate,
  })
  .refine(
    (v) =>
      +toClubWallDate(v.toDate) >= +toClubWallDate(v.fromDate) &&
      +toClubWallDate(v.toDate) - +toClubWallDate(v.fromDate) <= 366 * 86400000,
    'Periode maksimal 366 hari.',
  )
export const listCoachingHandler = factory.createHandlers(async (c) => {
  const items = await db.staff.findMany({
    where: { role: { in: ['COACH', 'BALLBOY'] } },
    select: coachingSelect,
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  })
  return c.json(ok(items))
})
export const getCoachingHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  async (c) => c.json(ok(await getCoachingPerson(db, c.req.valid('param').id))),
)
export const createCoachingHandler = factory.createHandlers(
  zValidator('json', coachingProfileSchema, validateHook),
  async (c) => {
    const input = c.req.valid('json'),
      branchId = c.get('branchId')
    if (!branchId)
      throw new BadRequestException(
        'Pilih satu cabang sebelum menambahkan layanan.',
      )
    assertCourtSportAtBranch(
      input.kind === 'BALLBOY' || input.coachType === 'PADEL_TENNIS'
        ? 'TENNIS'
        : input.coachType,
      branchId,
    )
    const staff = await db.staff.create({
      data: {
        branchId,
        name: input.name,
        role: input.kind,
        coachType: input.kind === 'COACH' ? input.coachType : null,
        coachProfile: input.coachProfile,
        phone: input.phone ? await formatPhone(input.phone) : null,
        isActive: input.isActive,
        adminServiceOnly: true,
        email: `service-${randomUUID()}@internal.invalid`,
        password: await hashPassword(randomUUID()),
      },
      select: coachingSelect,
    })
    return c.json(ok(staff), 201)
  },
)
export const updateCoachingHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  zValidator('json', coachingProfileSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param'),
      input = c.req.valid('json')
    const result = await db.$transaction(async (tx) => {
      await getCoachingPerson(tx, id)
      await tx.$queryRaw`SELECT id FROM staff WHERE id = ${id} FOR UPDATE`
      const existing = await getCoachingPerson(tx, id)
      if (existing.role !== input.kind)
        throw new BadRequestException('Jenis layanan tidak dapat diganti.')
      assertCourtSportAtBranch(
        input.kind === 'BALLBOY' || input.coachType === 'PADEL_TENNIS'
          ? 'TENNIS'
          : input.coachType,
        existing.branchId,
      )
      if (
        existing.coachType !==
          (input.kind === 'COACH' ? input.coachType : null) &&
        (await tx.bookingCoach.count({
          where: {
            slot: { staffId: id },
            status: { not: 'CANCELLED' },
            booking: { status: { not: 'CANCELLED' } },
          },
        }))
      )
        throw new BadRequestException(
          'Olahraga tidak dapat diganti setelah coach mempunyai booking. Nonaktifkan profil dan buat profil baru.',
        )
      return tx.staff.update({
        where: { id },
        data: {
          name: input.name,
          phone: input.phone ? await formatPhone(input.phone) : null,
          coachType: input.kind === 'COACH' ? input.coachType : null,
          coachProfile: input.coachProfile,
          isActive: input.isActive,
        },
        select: coachingSelect,
      })
    })
    return c.json(ok(result))
  },
)
export const getCoachingScheduleHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  zValidator('query', dateRange, validateHook),
  async (c) => {
    const q = c.req.valid('query')
    return c.json(
      ok(await coachingSchedule(c.req.valid('param').id, q.fromDate, q.toDate)),
    )
  },
)
export const saveCoachingScheduleHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  zValidator('json', coachingScheduleSchema, validateHook),
  async (c) =>
    c.json(
      ok(
        await saveCoachingSchedule(
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
)
export const toggleCoachingSlotHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  zValidator(
    'json',
    z
      .object({
        isAvailable: z.boolean().optional(),
        price: z.number().int().min(0).max(2147483647).optional(),
      })
      .strict()
      .refine(
        (v) => v.isAvailable !== undefined || v.price !== undefined,
        'Pilih perubahan slot.',
      ),
    validateHook,
  ),
  async (c) => {
    const { id } = c.req.valid('param'),
      { isAvailable, price } = c.req.valid('json')
    const result = await db.$transaction(async (tx) => {
      const slot = await tx.slot.findFirst({
        where: { id, type: { in: ['COACH', 'BALLBOY'] } },
      })
      if (!slot?.staffId)
        throw new BadRequestException('Slot layanan tidak ditemukan.')
      await getCoachingPerson(tx, slot.staffId)
      await tx.$queryRaw`SELECT id FROM staff WHERE id = ${slot.staffId} FOR UPDATE`
      const occupied = await tx.slot.count({
        where: {
          id,
          OR: [
            {
              bookingCoaches: {
                some: {
                  status: { not: 'CANCELLED' },
                  booking: { status: { not: 'CANCELLED' } },
                },
              },
            },
            {
              bookingBallboys: {
                some: {
                  status: { not: 'CANCELLED' },
                  booking: { status: { not: 'CANCELLED' } },
                },
              },
            },
          ],
        },
      })
      if (occupied)
        throw new BadRequestException(
          'Slot yang dibooking tidak dapat diubah. Batalkan pemesanan layanan terlebih dahulu.',
        )
      return tx.slot.update({ where: { id }, data: { isAvailable, price } })
    })
    return c.json(
      ok({
        id: result.id,
        isAvailable: result.isAvailable,
        price: result.price,
      }),
    )
  },
)
export const availableCoachingHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  zValidator(
    'query',
    z.object({ startAt: wallDatetime, endAt: wallDatetime }).strict(),
    validateHook,
  ),
  async (c) => {
    const q = c.req.valid('query')
    return c.json(
      ok(
        await coachingAvailability(c.req.valid('param').id, q.startAt, q.endAt),
      ),
    )
  },
)
export const attachCoachingHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  zValidator(
    'json',
    z
      .object({
        slotId: z.string().min(1).optional(),
        slotIds: z.array(z.string().min(1)).min(1).max(2).optional(),
        manualPayment: z
          .object({
            method: z.enum(['EDC', 'QRIS_STATIC', 'BANK_TRANSFER_MANUAL']),
            received: z.literal(true),
          })
          .strict()
          .optional(),
        paymentMethodId: z.string().min(1).optional(),
      })
      .strict()
      .refine((v) => !!v.slotId !== !!v.slotIds, 'Pilih layanan.')
      .refine(
        (v) => !(v.manualPayment && v.paymentMethodId),
        'Pilih satu metode pembayaran.',
      ),
    validateHook,
  ),
  async (c) => {
    const q = c.req.valid('json')
    return c.json(
      ok(
        await attachCoachingService(
          c.req.valid('param').id,
          q.slotIds ?? q.slotId!,
          c.get('admin')!.id,
          q.paymentMethodId,
          new Date(),
          q.manualPayment,
        ),
      ),
      201,
    )
  },
)
export const listCoachingBookingsHandler = factory.createHandlers(
  zValidator(
    'query',
    z
      .object({ kind: z.enum(['COACH', 'BALLBOY']), ...bookingDateRangeFields })
      .refine(validBookingDateRange, bookingDateRangeError),
    validateHook,
  ),
  async (c) => {
    const include = {
      slot: { include: { staff: { select: coachingSelect } } },
      courtSlot: {
        include: { court: { select: { name: true, sport: true } } },
      },
      booking: {
        include: {
          user: { select: { name: true, phone: true } },
          invoice: {
            select: {
              id: true,
              number: true,
              status: true,
              total: true,
              dueDate: true,
            },
          },
        },
      },
    }
    const query = c.req.valid('query')
    const kind = query.kind
    const range = playingDateRange(query)
    const where = range ? { slot: { startAt: range } } : {}
    const items =
      kind === 'COACH'
        ? await db.bookingCoach.findMany({
            include,
            where,
            orderBy: { createdAt: 'desc' },
            take: 500,
          })
        : await db.bookingBallboy.findMany({
            include,
            where,
            orderBy: { createdAt: 'desc' },
            take: 500,
          })
    return c.json(
      ok(
        items.map((item) => ({
          id: item.id,
          bookingId: item.bookingId,
          name: item.slot.staff?.name ?? '-',
          customer: item.booking.user.name,
          phone: item.booking.user.phone,
          startAt: formatClubWallClock(item.slot.startAt),
          endAt: formatClubWallClock(item.slot.endAt),
          court: item.courtSlot?.court?.name ?? '-',
          price: item.price,
          status:
            item.status === 'CANCELLED' ? 'CANCELLED' : item.booking.status,
          invoice: item.booking.invoice,
        })),
      ),
    )
  },
)

export const availableCoachReplacementsHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  async (c) =>
    c.json(ok(await availableCoachReplacements(c.req.valid('param').id))),
)
export const replaceBookedCoachHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  zValidator(
    'json',
    z
      .object({
        slotId: z.string().min(1),
        expectedSlotId: z.string().min(1),
        reason: z.string().trim().max(500).optional(),
      })
      .strict(),
    validateHook,
  ),
  async (c) =>
    c.json(
      ok(
        await replaceBookedCoach(
          c.req.valid('param').id,
          c.req.valid('json'),
          c.get('admin')!.id,
        ),
      ),
    ),
)

export const previewCoachCancellationHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  async (c) =>
    c.json(ok(await previewCoachCancellation(c.req.valid('param').id))),
)
