import { CourtSport } from '@prisma/client'
import dayjs from 'dayjs'

type CourtBundleSlot = {
  id: string
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

export function getCourtCoachBundleDiscount(courtSlot: CourtBundleSlot) {
  const sport = courtSlot.court?.sport
  if (sport === CourtSport.TENNIS) return 100_000

  const hour = dayjs(courtSlot.startAt).hour()
  if (hour >= 6 && hour <= 14) return 100_000
  if (hour >= 15 && hour <= 23) return 70_000
  return 0
}

export function getCourtCoachBundleDiscountByCourtSlot(
  courtSlots: CourtBundleSlot[],
  coachSlots: CoachBundleSlot[],
) {
  const coachKeys = new Set(coachSlots.map(getSlotKey))
  const discountByCourtSlotId = new Map<string, number>()

  for (const courtSlot of courtSlots) {
    if (!coachKeys.has(getSlotKey(courtSlot))) continue

    const discount = getCourtCoachBundleDiscount(courtSlot)
    if (discount > 0) {
      discountByCourtSlotId.set(courtSlot.id, discount)
    }
  }

  return discountByCourtSlotId
}
