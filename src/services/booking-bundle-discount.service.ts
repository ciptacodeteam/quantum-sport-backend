import { CourtSport } from '@prisma/client'
import {
  resolveTariffPeriod,
  tariffBand,
  type TariffRule,
} from '@/lib/tariff-period'
import { branchContext } from '@/lib/branch-context'

type CourtBundleSlot = {
  id: string
  branchId?: string
  startAt: Date
  endAt: Date
  court?: { sport: CourtSport } | null
}

type CoachBundleSlot = {
  startAt: Date
  endAt: Date
}

const getSlotKey = (slot: { startAt: Date; endAt: Date }) =>
  `${slot.startAt.toISOString()}|${slot.endAt.toISOString()}`

export function getCourtCoachBundleDiscount(
  courtSlot: CourtBundleSlot,
  rules: TariffRule[] = [],
) {
  const sport = courtSlot.court?.sport
  if (sport === CourtSport.TENNIS) return 100_000

  const band = tariffBand(
    courtSlot.startAt,
    resolveTariffPeriod(
      rules,
      courtSlot.startAt,
      courtSlot.branchId ?? branchContext.getStore()?.branchId ?? '',
      sport ?? 'PADEL',
    ),
    courtSlot.endAt,
  )
  if (band === 'happyHour') return 100_000
  if (band === 'peakHour') return 70_000
  return 0
}

export function getCourtCoachBundleDiscountByCourtSlot(
  courtSlots: CourtBundleSlot[],
  coachSlots: CoachBundleSlot[],
  rules: TariffRule[] = [],
) {
  const coachKeys = new Set(coachSlots.map(getSlotKey))
  const discountByCourtSlotId = new Map<string, number>()

  for (const courtSlot of courtSlots) {
    if (!coachKeys.has(getSlotKey(courtSlot))) continue

    const discount = getCourtCoachBundleDiscount(courtSlot, rules)
    if (discount > 0) {
      discountByCourtSlotId.set(courtSlot.id, discount)
    }
  }

  return discountByCourtSlotId
}
