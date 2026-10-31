import { MembershipType } from '@prisma/client'
import {
  resolveTariffPeriod,
  tariffBand,
  type TariffRule,
} from '@/lib/tariff-period'
import { branchContext } from '@/lib/branch-context'

export function isSlotAllowedForMembershipType(
  membershipType: MembershipType | null | undefined,
  startAt: Date | string,
  options: {
    rules?: TariffRule[]
    branchId?: string
    sport?: string
    endAt?: Date | string
  } = {},
) {
  if (!membershipType || membershipType === MembershipType.ALL_HOUR) {
    return true
  }

  const bands = resolveTariffPeriod(
    options.rules ?? [],
    startAt,
    options.branchId ?? branchContext.getStore()?.branchId ?? '',
    options.sport ?? 'PADEL',
  )
  const band = tariffBand(startAt, bands, options.endAt)
  return membershipType === MembershipType.HAPPY_HOUR
    ? band === 'happyHour'
    : band === 'peakHour'
}

export function membershipTypeLabel(membershipType: MembershipType) {
  if (membershipType === MembershipType.HAPPY_HOUR) return 'Happy Hour'
  if (membershipType === MembershipType.AFTER_HOUR) return 'Peak Hour'
  return 'All Hour'
}
