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
  const bands = resolveTariffPeriod(
    rules,
    courtSlot.startAt,
    courtSlot.branchId ?? branchContext.getStore()?.branchId ?? '',
    courtSlot.court?.sport ?? CourtSport.PADEL,
  )
  const band = tariffBand(courtSlot.startAt, bands, courtSlot.endAt)
  if (band === 'happyHour') return bands.happyCoachDiscount ?? 0
  if (band === 'peakHour') return bands.peakCoachDiscount ?? 0
  return 0
}

/** For direct hourly coaching only; null keeps the inclusive single-hour tariff. */
export function getInHouseCourtDiscount(
  courtSlot: CourtBundleSlot,
  rules: TariffRule[] = [],
) {
  const bands = resolveTariffPeriod(
    rules,
    courtSlot.startAt,
    courtSlot.branchId ?? branchContext.getStore()?.branchId ?? '',
    courtSlot.court?.sport ?? CourtSport.PADEL,
  )
  if (
    bands.happyInHouseCoachDiscount == null &&
    bands.peakInHouseCoachDiscount == null
  )
    return null
  const band = tariffBand(courtSlot.startAt, bands, courtSlot.endAt)
  if (band === 'happyHour') return bands.happyInHouseCoachDiscount ?? null
  if (band === 'peakHour') return bands.peakInHouseCoachDiscount ?? null
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

/** Fixed court price for direct in-house sessions, independent of happy/peak bands. */
export function getInHouseCourtHourlyPrice(
  courtSlot: CourtBundleSlot,
  rules: TariffRule[] = [],
) {
  return (
    resolveTariffPeriod(
      rules,
      courtSlot.startAt,
      courtSlot.branchId ?? branchContext.getStore()?.branchId ?? '',
      courtSlot.court?.sport ?? CourtSport.PADEL,
    ).inHouseCourtHourlyPrice ?? null
  )
}
