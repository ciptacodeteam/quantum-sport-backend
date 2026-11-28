import {
  resolveTariffPeriod,
  tariffBand,
  type TariffRule,
} from './tariff-period'
import { clubWallDateString } from './club-time'
export type ManagementCustomer = {
  isManagement?: boolean
  managementCourtHourlyPrice?: number | null
  managementCoachHourlyPrice?: number | null
  managementExtraParticipantHourlyPrice?: number | null
  managementPadelHappyHourlyPrice?: number | null
  managementPadelPeakHourlyPrice?: number | null
  managementTennisHappyHourlyPrice?: number | null
  managementTennisPeakHourlyPrice?: number | null
  managementValidFrom?: Date | string | null
  managementValidUntil?: Date | string | null
}

/** Only admin checkout supplies this verified customer; validity follows the playing date. */
function managementEligible(
  customer: ManagementCustomer | null | undefined,
  playingAt: Date | string,
): customer is ManagementCustomer {
  if (!customer?.isManagement) return false
  const day = clubWallDateString(playingAt)
  if (
    customer.managementValidFrom &&
    day < clubWallDateString(customer.managementValidFrom)
  )
    return false
  return true
}

export function managementInHouseRate(
  customer: ManagementCustomer | null | undefined,
  playingAt: Date | string,
) {
  if (!managementEligible(customer, playingAt)) return null
  const court =
    (customer.managementCourtHourlyPrice ?? 0) > 0
      ? customer.managementCourtHourlyPrice!
      : null
  const coach =
    (customer.managementCoachHourlyPrice ?? 0) > 0
      ? customer.managementCoachHourlyPrice!
      : null
  const extraParticipantHourlyPrice =
    (customer.managementExtraParticipantHourlyPrice ?? 0) > 0
      ? customer.managementExtraParticipantHourlyPrice!
      : null
  if (court === null && coach === null && extraParticipantHourlyPrice === null)
    return null
  return { court, coach, extraParticipantHourlyPrice }
}

/** Court-only/club sessions use their sport and the playing-date tariff band. */
export function managementCourtRate(
  customer: ManagementCustomer | null | undefined,
  slot: {
    startAt: Date
    endAt: Date
    branchId: string
    court?: { sport: string } | null
  },
  rules: TariffRule[],
) {
  if (!managementEligible(customer, slot.startAt)) return null
  const sport = slot.court?.sport
  if (sport !== 'PADEL' && sport !== 'TENNIS') return null
  const bands = resolveTariffPeriod(rules, slot.startAt, slot.branchId, sport)
  const band = tariffBand(slot.startAt, bands, slot.endAt)
  if (!band) return null
  const rate =
    sport === 'PADEL'
      ? band === 'happyHour'
        ? customer.managementPadelHappyHourlyPrice
        : customer.managementPadelPeakHourlyPrice
      : band === 'happyHour'
        ? customer.managementTennisHappyHourlyPrice
        : customer.managementTennisPeakHourlyPrice
  return rate != null && rate > 0 ? rate : null
}
