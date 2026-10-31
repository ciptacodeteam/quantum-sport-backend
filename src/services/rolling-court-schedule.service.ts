import { ensureRecurringBookings } from '@/services/recurring-booking.service'
import { branchContext, withBranchContext } from '@/lib/branch-context'
import { db } from '@/lib/prisma'
import dayjs from '@/lib/club-time'
import { BadRequestException, NotFoundException } from '@/exceptions'
import {
  matchesRollingSlotRule,
  rollingSlotRuleSchema,
  type RollingSlotRule,
} from '@/lib/rolling-slot-rule'
import { applyRollingSlotRule } from '@/services/rolling-slot-rule.service'
import {
  bookingWindowEnd,
  buildRollingCourtSlots,
  rollingCourtPricingSchema,
  type RollingCourtPricing,
} from '@/lib/rolling-booking-window'
import type { Court, Prisma } from '@prisma/client'
import { getTariffPeriods } from '@/services/tariff-policy.service'

async function generate(
  tx: Prisma.TransactionClient,
  court: Court,
  now: Date,
  reconfigure = false,
  notBefore?: Date,
) {
  const config = rollingCourtPricingSchema.parse({
    ...(court.rollingPricing as object),
    courtId: court.id,
    months: court.bookingWindowMonths,
  })
  const end = bookingWindowEnd(config.months, now)
  if (
    !reconfigure &&
    court.slotsGeneratedThrough &&
    !dayjs(court.slotsGeneratedThrough).isBefore(dayjs(end), 'day')
  )
    return
  let from =
    reconfigure || !court.slotsGeneratedThrough
      ? dayjs(now).startOf('day').toDate()
      : dayjs(court.slotsGeneratedThrough.toISOString().slice(0, 10))
          .add(1, 'day')
          .toDate()
  if (notBefore && notBefore > from) from = notBefore
  const tariffRules = await getTariffPeriods(tx, court.branchId)
  const slots = buildRollingCourtSlots(
    { ...config, sport: court.sport },
    court.branchId,
    from,
    now,
    tariffRules,
  )
  // Unique court+start constraint and skipDuplicates preserve existing IDs, manual closures and bookings.
  if (slots.length) {
    await tx.slot.createMany({ data: slots, skipDuplicates: true })
    await tx.courtCostSchedule.createMany({
      data: slots.map((slot) => ({
        branchId: court.branchId,
        courtId: court.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
        price: slot.price!,
        discountPrice: slot.discountPrice!,
        isAvailable: true,
      })),
      skipDuplicates: true,
    })
  }
  const future = {
    courtId: court.id,
    type: 'COURT' as const,
    startAt: { gt: now },
    bookingDetails: {
      none: { booking: { status: { not: 'CANCELLED' as const } } },
    },
  }
  // Reconcile only the newly exposed segment (or full window on a settings save).
  // Older rows beyond the horizon may exist after shortening a duration.
  const segment = {
    courtId: court.id,
    type: 'COURT' as const,
    startAt: { gt: new Date(Math.max(+now, +from - 1)), lte: end },
  }
  await tx.slot.updateMany({
    where: {
      ...segment,
      NOT: { startAt: { in: slots.map((s) => s.startAt) } },
    },
    data: { scheduleClosed: true },
  })
  await tx.slot.updateMany({
    where: {
      courtId: court.id,
      type: 'COURT',
      startAt: { in: slots.map((s) => s.startAt) },
    },
    data: { scheduleClosed: false },
  })
  // Only currently available rows receive new prices; holds and manual closures stay intact.
  const prices = new Map<string, typeof slots>()
  for (const slot of slots) {
    const key = `${slot.price}:${slot.discountPrice}`
    const group = prices.get(key) ?? []
    group.push(slot)
    prices.set(key, group)
  }
  for (const group of prices.values()) {
    const times = group.map((slot) => slot.startAt)
    const data = {
      price: group[0].price!,
      discountPrice: group[0].discountPrice!,
    }
    const updated = await tx.slot.updateManyAndReturn({
      where: { ...future, isAvailable: true, startAt: { in: times } },
      data,
      select: { startAt: true },
    })
    if (updated.length)
      await tx.courtCostSchedule.updateMany({
        where: {
          courtId: court.id,
          startAt: { in: updated.map((slot) => slot.startAt) },
        },
        data,
      })
  }
  const closedTimes = slots
    .filter((slot) =>
      config.bulkRules?.some(
        (rule) =>
          rule.kind === 'disable' && matchesRollingSlotRule(slot.startAt, rule),
      ),
    )
    .map((slot) => slot.startAt)
  if (closedTimes.length) {
    await tx.slot.updateMany({
      where: { ...future, isAvailable: true, startAt: { in: closedTimes } },
      data: { isAvailable: false },
    })
  }
  await tx.court.update({
    where: { id: court.id },
    data: {
      slotsGeneratedThrough: new Date(
        `${dayjs(end).format('YYYY-MM-DD')}T00:00:00Z`,
      ),
    },
  })
}

export async function refreshTariffCourtSchedules(
  tx: Prisma.TransactionClient,
  branchId: string,
  sport: 'PADEL' | 'TENNIS',
  effectiveFrom: Date,
  now = new Date(),
) {
  const courts = await tx.court.findMany({
    where: { branchId, sport, bookingWindowMonths: { not: null } },
    orderBy: { id: 'asc' },
  })
  for (const court of courts) {
    await tx.$queryRaw`SELECT id FROM courts WHERE id = ${court.id} FOR UPDATE`
    const fresh = await tx.court.findUniqueOrThrow({ where: { id: court.id } })
    await generate(tx, fresh, now, true, effectiveFrom)
  }
}

export async function saveRollingCourtSchedule(
  config: RollingCourtPricing,
  now = new Date(),
) {
  config = rollingCourtPricingSchema.parse(config)
  return db.$transaction(async (tx) => {
    const court = await tx.court.findUnique({ where: { id: config.courtId } })
    if (!court) throw new NotFoundException('Court not found')
    await tx.$queryRaw`SELECT id FROM courts WHERE id = ${court.id} FOR UPDATE`
    const fresh = await tx.court.findUniqueOrThrow({ where: { id: court.id } })
    const bulkRules = rollingSlotRuleSchema
      .array()
      .parse(
        (fresh.rollingPricing as { bulkRules?: unknown } | null)?.bulkRules ??
          [],
      )
    // Preserve bulk rules when the main schedule form changes its base settings.
    const updated = await tx.court.update({
      where: { id: court.id },
      data: {
        bookingWindowMonths: config.months,
        rollingPricing: { ...config, bulkRules },
      },
    })
    await generate(tx, updated, now, true)
    return updated
  })
}

export async function saveRollingCourtSlotRule(
  courtId: string,
  input: RollingSlotRule,
  now = new Date(),
) {
  const rule = rollingSlotRuleSchema.parse(input)
  return db.$transaction(async (tx) => {
    // Use the same lock as rolling saves and daily extension to avoid losing rules.
    const existing = await tx.court.findUnique({ where: { id: courtId } })
    if (!existing) throw new NotFoundException('Court not found')
    await tx.$queryRaw`SELECT id FROM courts WHERE id = ${courtId} FOR UPDATE`
    const court = await tx.court.findUniqueOrThrow({ where: { id: courtId } })
    if (!court.bookingWindowMonths || !court.rollingPricing)
      throw new BadRequestException(
        'Atur jadwal otomatis lapangan terlebih dahulu.',
      )
    const config = rollingCourtPricingSchema.parse({
      ...(court.rollingPricing as object),
      courtId,
      months: court.bookingWindowMonths,
    })
    await generate(tx, court, now)
    await tx.court.update({
      where: { id: courtId },
      data: {
        rollingPricing: {
          ...config,
          bulkRules: [...(config.bulkRules ?? []), rule],
        },
      },
    })
    return applyRollingSlotRule(
      tx,
      courtId,
      rule,
      now,
      bookingWindowEnd(config.months, now),
    )
  })
}

/** Called by reads as well as the worker, so a stopped worker cannot leave new dates empty. */
export async function ensureRollingCourtSchedules(
  courtId?: string,
  now = new Date(),
) {
  const courts = await db.court.findMany({
    where: {
      ...(courtId ? { id: courtId } : {}),
      isActive: true,
      bookingWindowMonths: { not: null },
    },
  })
  for (const court of courts) {
    const end = bookingWindowEnd(court.bookingWindowMonths!, now)
    if (
      court.slotsGeneratedThrough &&
      court.slotsGeneratedThrough.toISOString().slice(0, 10) >=
        dayjs(end).format('YYYY-MM-DD')
    )
      continue
    const extend = () =>
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM courts WHERE id = ${court.id} FOR UPDATE`
        const fresh = await tx.court.findUnique({ where: { id: court.id } })
        if (fresh?.isActive && fresh.bookingWindowMonths)
          await generate(tx, fresh, now)
      })
    const context = branchContext.getStore()
    // A super admin may browse all branches; generation still writes one branch at a time.
    if (context && !context.branchId && context.isSuperAdmin) {
      await withBranchContext({ ...context, branchId: court.branchId }, extend)
    } else {
      await extend()
    }
  }
  await ensureRecurringBookings(now)
}
