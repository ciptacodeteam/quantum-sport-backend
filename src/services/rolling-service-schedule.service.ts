import { db } from '@/lib/prisma'
import { branchContext, withBranchContext } from '@/lib/branch-context'
import { courtBookingCutoff } from '@/lib/booking-time-policy'
import { rollingBookingWindowWhere } from '@/lib/rolling-booking-window'
import {
  buildRollingCoachingSlots,
  rollingCoachingScheduleSchema,
} from '@/lib/coaching-policy'
import { Prisma, type Staff } from '@prisma/client'

export async function reconcileRollingServiceSchedule(
  tx: Prisma.TransactionClient,
  staff: Staff,
  now = new Date(),
  reprice = false,
) {
  const config = rollingCoachingScheduleSchema.parse(
    staff.rollingServiceSchedule,
  )
  const courts = await tx.slot.findMany({
    where: {
      branchId: staff.branchId,
      type: 'COURT',
      startAt: { gt: courtBookingCutoff(now) },
      AND: [
        rollingBookingWindowWhere(now),
        {
          court: {
            isActive: true,
            bookingWindowMonths: { not: null },
            sport:
              staff.role === 'BALLBOY' || staff.coachType === 'PADEL_TENNIS'
                ? { in: ['PADEL', 'TENNIS'] }
                : (staff.coachType ?? 'PADEL'),
          },
        },
      ],
    },
    select: { startAt: true, endAt: true },
  })
  const proposed = buildRollingCoachingSlots(config, courts, now)
  const existing = await tx.slot.findMany({
    where: { staffId: staff.id, startAt: { gt: courtBookingCutoff(now) } },
    include: {
      bookingCoaches: {
        where: {
          status: { not: 'CANCELLED' },
          booking: { status: { not: 'CANCELLED' } },
        },
        select: { id: true },
      },
      bookingBallboys: {
        where: {
          status: { not: 'CANCELLED' },
          booking: { status: { not: 'CANCELLED' } },
        },
        select: { id: true },
      },
    },
  })
  const rangeKey = (s: { startAt: Date; endAt: Date }) =>
    `${+s.startAt}|${+s.endAt}`
  const desired = new Set(proposed.map(rangeKey))
  const protectedSlot = (s: (typeof existing)[number]) =>
    s.bookingCoaches.length > 0 || s.bookingBallboys.length > 0
  const close = existing.filter(
    (s) => !protectedSlot(s) && !desired.has(rangeKey(s)),
  )
  if (close.length)
    await tx.slot.updateMany({
      where: { id: { in: close.map((s) => s.id) } },
      data: { scheduleClosed: true },
    })
  const reopen = existing.filter(
    (s) => !protectedSlot(s) && desired.has(rangeKey(s)),
  )
  if (reopen.length)
    await tx.slot.updateMany({
      where: { id: { in: reopen.map((s) => s.id) } },
      data: { scheduleClosed: false },
    })
  const priceable = reopen.filter((s) => s.isAvailable)
  if (reprice && priceable.length)
    await tx.slot.updateMany({
      where: { id: { in: priceable.map((s) => s.id) }, isAvailable: true },
      data: {
        price: config.price,
        additionalHourPrice:
          staff.role === 'COACH' ? (config.additionalHourPrice ?? null) : null,
      },
    })
  const ordered = [...existing].sort((a, b) => +a.startAt - +b.startAt)
  let cursor = 0
  const fresh = [...proposed]
    .sort((a, b) => +a.startAt - +b.startAt)
    .filter((slot) => {
      while (cursor < ordered.length && ordered[cursor].endAt <= slot.startAt)
        cursor++
      return cursor >= ordered.length || ordered[cursor].startAt >= slot.endAt
    })
  const result = fresh.length
    ? await tx.slot.createMany({
        data: fresh.map((s) => ({
          ...s,
          additionalHourPrice:
            staff.role === 'COACH'
              ? (config.additionalHourPrice ?? null)
              : null,
          branchId: staff.branchId,
          staffId: staff.id,
          type: staff.role === 'BALLBOY' ? 'BALLBOY' : 'COACH',
          isAvailable: true,
        })),
        skipDuplicates: true,
      })
    : { count: 0 }
  return {
    created: result.count,
    updated: reprice ? priceable.length : 0,
    skipped: existing.filter(protectedSlot).length,
  }
}

/** Extend services whenever the court rolling window advances; staff lock preserves manual edits. */
export async function ensureRollingServiceSchedules(
  now = new Date(),
  role?: 'COACH' | 'BALLBOY',
) {
  const staff = await db.staff.findMany({
    where: {
      isActive: true,
      role: role ?? { in: ['COACH', 'BALLBOY'] },
      rollingServiceSchedule: { not: Prisma.AnyNull },
    },
  })
  for (const person of staff) {
    const reconcile = () =>
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM staff WHERE id = ${person.id} FOR UPDATE`
        const fresh = await tx.staff.findUnique({ where: { id: person.id } })
        if (fresh?.isActive && fresh.rollingServiceSchedule)
          await reconcileRollingServiceSchedule(tx, fresh, now)
      })
    const context = branchContext.getStore()
    if (context && !context.branchId && context.isSuperAdmin)
      await withBranchContext(
        { ...context, branchId: person.branchId },
        reconcile,
      )
    else await reconcile()
  }
}
