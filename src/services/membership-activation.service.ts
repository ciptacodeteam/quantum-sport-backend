import type { Prisma } from '@prisma/client'
import dayjs from 'dayjs'

export const AWAITING_PAYMENT_SUSPENSION_REASON = 'Awaiting payment'

type MembershipActivationDb = {
  membershipUser: {
    findUnique: Prisma.TransactionClient['membershipUser']['findUnique']
    update: Prisma.TransactionClient['membershipUser']['update']
    deleteMany: Prisma.TransactionClient['membershipUser']['deleteMany']
  }
  invoice: {
    updateMany: Prisma.TransactionClient['invoice']['updateMany']
  }
}

/**
 * Activate a membership after successful payment.
 * Duration starts at payment time so unpaid checkout wait does not consume days.
 */
export async function activateMembershipAfterPayment(
  tx: MembershipActivationDb,
  membershipUserId: string,
  now = new Date(),
): Promise<boolean> {
  const membershipUser = await tx.membershipUser.findUnique({
    where: { id: membershipUserId },
    include: {
      membership: {
        select: {
          duration: true,
        },
      },
    },
  })

  if (!membershipUser) {
    return false
  }

  const startDate = now
  const endDate = dayjs(now)
    .add(membershipUser.membership.duration, 'days')
    .toDate()

  await tx.membershipUser.update({
    where: { id: membershipUserId },
    data: {
      startDate,
      endDate,
      remainingDuration: membershipUser.membership.duration,
      isExpired: false,
      isSuspended: false,
      suspensionReason: null,
      suspensionEndDate: null,
    },
  })

  return true
}

/**
 * Remove an unpaid membership purchase and detach it from any invoice.
 */
export async function discardUnpaidMembership(
  tx: MembershipActivationDb,
  membershipUserId: string,
): Promise<boolean> {
  await tx.invoice.updateMany({
    where: { membershipUserId },
    data: { membershipUserId: null },
  })

  const deleted = await tx.membershipUser.deleteMany({
    where: { id: membershipUserId },
  })

  return deleted.count > 0
}
