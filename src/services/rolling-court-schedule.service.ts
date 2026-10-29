import { branchContext, withBranchContext } from '@/lib/branch-context'
import { db } from '@/lib/prisma'
import dayjs from '@/lib/club-time'
import { NotFoundException } from '@/exceptions'
import {
  bookingWindowEnd,
  buildRollingCourtSlots,
  rollingCourtPricingSchema,
  type RollingCourtPricing,
} from '@/lib/rolling-booking-window'
import type { Court, Prisma } from '@prisma/client'

async function generate(
  tx: Prisma.TransactionClient,
  court: Court,
  now: Date,
  reconfigure = false,
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
  const from =
    reconfigure || !court.slotsGeneratedThrough
      ? dayjs(now).startOf('day').toDate()
      : dayjs(court.slotsGeneratedThrough.toISOString().slice(0, 10))
          .add(1, 'day')
          .toDate()
  const slots = buildRollingCourtSlots(config, court.branchId, from, now)
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
  for (const band of ['happyHour', 'peakHour'] as const) {
    const times = slots
      .filter((s) => dayjs(s.startAt).hour() < 15 === (band === 'happyHour'))
      .map((s) => s.startAt)
    if (!times.length) continue
    await tx.slot.updateMany({
      where: { ...future, isAvailable: true, startAt: { in: times } },
      data: {
        price: config[`${band}Price`],
        discountPrice: config[`${band}DiscountPrice`],
      },
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

export async function saveRollingCourtSchedule(
  config: RollingCourtPricing,
  now = new Date(),
) {
  config = rollingCourtPricingSchema.parse(config)
  return db.$transaction(async (tx) => {
    const court = await tx.court.findUnique({ where: { id: config.courtId } })
    if (!court) throw new NotFoundException('Court not found')
    // UPDATE locks the court row, serializing saves and daily generation.
    const updated = await tx.court.update({
      where: { id: court.id },
      data: {
        bookingWindowMonths: config.months,
        rollingPricing: config,
      },
    })
    await generate(tx, updated, now, true)
    return updated
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
}
