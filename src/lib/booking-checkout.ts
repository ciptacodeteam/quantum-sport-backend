import type { Prisma } from '@prisma/client'

export const bookingCheckoutTypes = [
  'regular',
  'membership',
  'coach_training',
  'event',
] as const
export type BookingCheckoutType = (typeof bookingCheckoutTypes)[number]

/** Classify the actual checkout, rather than whether the customer owns a membership. */
export function bookingCheckoutWhere(
  type?: BookingCheckoutType,
): Prisma.BookingWhereInput {
  if (type === 'membership')
    return {
      OR: [
        { membershipUserId: { not: null } },
        { membershipSessionsUsed: { gt: 0 } },
      ],
    }
  if (type === 'regular')
    return {
      purpose: 'REGULAR',
      membershipUserId: null,
      membershipSessionsUsed: 0,
    }
  if (type === 'coach_training') return { purpose: 'COACH_TRAINING' }
  if (type === 'event') return { purpose: 'EVENT' }
  return {}
}
