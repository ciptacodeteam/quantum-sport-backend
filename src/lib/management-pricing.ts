import { clubWallDateString } from './club-time'
export type ManagementCustomer = {
  isManagement?: boolean
  managementValidFrom?: Date | string | null
  managementValidUntil?: Date | string | null
}
export type ManagementTariff = {
  managementCourtHourlyPrice?: number | null
  managementCoachHourlyPrice?: number | null
}
/** Only admin checkout supplies this verified customer; validity follows the playing date. */
export function managementInHouseRate(
  customer: ManagementCustomer | null | undefined,
  playingAt: Date | string,
  tariff: ManagementTariff,
) {
  if (!customer?.isManagement) return null
  const day = clubWallDateString(playingAt)
  if (
    customer.managementValidFrom &&
    day < clubWallDateString(customer.managementValidFrom)
  )
    return null
  if (
    customer.managementValidUntil &&
    day > clubWallDateString(customer.managementValidUntil)
  )
    return null
  const court = tariff.managementCourtHourlyPrice
  const coach = tariff.managementCoachHourlyPrice
  if (court == null || coach == null) return null
  return { court, coach }
}
