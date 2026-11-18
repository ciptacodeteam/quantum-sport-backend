import { clubWallDateString } from './club-time'
export type ManagementCustomer = {
  isManagement?: boolean
  managementCourtHourlyPrice?: number | null
  managementCoachHourlyPrice?: number | null
  managementValidFrom?: Date | string | null
  managementValidUntil?: Date | string | null
}

/** Only admin checkout supplies this verified customer; validity follows the playing date. */
export function managementInHouseRate(
  customer: ManagementCustomer | null | undefined,
  playingAt: Date | string,
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
  const court =
    (customer.managementCourtHourlyPrice ?? 0) > 0
      ? customer.managementCourtHourlyPrice!
      : null
  const coach =
    (customer.managementCoachHourlyPrice ?? 0) > 0
      ? customer.managementCoachHourlyPrice!
      : null
  if (court === null && coach === null) return null
  return { court, coach }
}
