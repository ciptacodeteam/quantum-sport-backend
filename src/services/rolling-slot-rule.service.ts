import type { Prisma } from '@prisma/client'
import {
  matchesRollingSlotRule,
  type RollingSlotRule,
} from '@/lib/rolling-slot-rule'

/** Apply only this rule, preserving all prices and closures outside its filter. */
export async function applyRollingSlotRule(
  tx: Prisma.TransactionClient,
  courtId: string,
  rule: RollingSlotRule,
  now: Date,
  end: Date,
) {
  const slots = await tx.slot.findMany({
    where: {
      courtId,
      type: 'COURT',
      startAt: { gt: now, lte: end },
      scheduleClosed: false,
    },
    select: { id: true, startAt: true },
  })
  const matched = slots.filter((slot) =>
    matchesRollingSlotRule(slot.startAt, rule),
  )
  const where = {
    courtId,
    type: 'COURT' as const,
    id: { in: matched.map((slot) => slot.id) },
    scheduleClosed: false,
    bookingDetails: {
      none: { booking: { status: { not: 'CANCELLED' as const } } },
    },
  }
  let updatedCount = 0
  if (matched.length && rule.kind === 'disable') {
    const updated = await tx.slot.updateMany({
      where: { ...where, isAvailable: true },
      data: { isAvailable: false },
    })
    updatedCount = updated.count
  } else if (matched.length && rule.kind === 'pricing') {
    const data = { price: rule.price, discountPrice: rule.discountPrice }
    const updated = await tx.slot.updateManyAndReturn({
      where,
      data,
      select: { startAt: true },
    })
    updatedCount = updated.length
    if (updated.length)
      await tx.courtCostSchedule.updateMany({
        where: {
          courtId,
          startAt: { in: updated.map((slot) => slot.startAt) },
        },
        data,
      })
  }
  return {
    matchedCount: matched.length,
    updatedCount,
    skippedCount: matched.length - updatedCount,
    rollingRuleSaved: true,
  }
}
