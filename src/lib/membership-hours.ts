import { MembershipType } from '@prisma/client'
import dayjs from 'dayjs'

export function isSlotAllowedForMembershipType(
  membershipType: MembershipType | null | undefined,
  startAt: Date | string,
) {
  if (!membershipType || membershipType === MembershipType.ALL_HOUR) {
    return true
  }

  const hour = dayjs(startAt).hour()

  if (membershipType === MembershipType.HAPPY_HOUR) {
    return hour >= 6 && hour < 15
  }

  return hour >= 15 || hour < 6
}

export function membershipTypeLabel(membershipType: MembershipType) {
  if (membershipType === MembershipType.HAPPY_HOUR) return 'Happy Hour (06:00 - 15:00)'
  if (membershipType === MembershipType.AFTER_HOUR) return 'After Hour (15:00 - 00:00)'
  return 'All Hour'
}
