import type { Prisma } from '@prisma/client'
import {
  creditMembershipIncludingTransferredDebt,
  lockCustomerWallet,
  restoreRecurringMembershipDebits,
  withCustomerWallet,
} from './membership-renewal.service'
type MembershipBookingUsage = {
  id?: string
  membershipUserId?: string | null
  membershipSessionsUsed?: number | null
}

type MembershipCourtSlot = {
  startAt: Date
  endAt: Date
}

type MembershipBookingTransaction = Partial<
  Pick<
    Prisma.TransactionClient,
    | 'membershipSessionDebit'
    | 'membershipDebtTransfer'
    | 'booking'
    | '$queryRaw'
  >
> & {
  membershipUser: {
    findUnique: (args: {
      where: { id: string }
      include: {
        membership: {
          select: {
            sessions: true
          }
        }
      }
    }) => Promise<{
      id: string
      remainingSessions: number
      endDate: Date
      membership: {
        sessions: number
      }
    } | null>
    update: (args: {
      where: { id: string }
      data: {
        remainingSessions: { increment: number }
        isExpired: boolean
      }
    }) => Promise<unknown>
  }
}

export function calculateMembershipSessionsForCourtSlots(
  courtSlots: MembershipCourtSlot[],
) {
  const totalMinutes = courtSlots.reduce((total, slot) => {
    const durationMs = slot.endAt.getTime() - slot.startAt.getTime()

    return total + Math.max(0, durationMs / 60_000)
  }, 0)

  if (totalMinutes === 0) {
    return 0
  }

  return Math.ceil(totalMinutes / 60)
}

export async function restoreMembershipSessionsForCancelledBooking(
  tx: MembershipBookingTransaction,
  booking: MembershipBookingUsage,
) {
  if (!booking.membershipUserId || !booking.membershipSessionsUsed) {
    return 0
  }

  const sessionsToRestore = Math.max(
    0,
    Math.trunc(booking.membershipSessionsUsed),
  )
  if (sessionsToRestore === 0) {
    return 0
  }

  if (booking.id && tx.membershipSessionDebit && tx.booking && tx.$queryRaw) {
    const restored = await restoreRecurringMembershipDebits(
      tx as unknown as Prisma.TransactionClient,
      booking.id,
    )
    if (restored !== null) return restored
  }

  // Hold expiry can refund a normal booking while a new package is being paid.
  if (tx.$queryRaw) {
    const walletTx = tx as unknown as Prisma.TransactionClient
    const identity = await withCustomerWallet(() => walletTx.membershipUser.findUnique({ where: { id: booking.membershipUserId! }, select: { userId: true } }))
    if (identity) await lockCustomerWallet(walletTx, identity.userId)
  }

  const membershipUser = await tx.membershipUser.findUnique({
    where: { id: booking.membershipUserId },
    include: {
      membership: {
        select: {
          sessions: true,
        },
      },
    },
  })

  if (!membershipUser) {
    return 0
  }

  const transferredDebt = tx.membershipDebtTransfer
    ? await withCustomerWallet(() =>
        tx.membershipDebtTransfer!.findMany({
          where: { fromMembershipUserId: membershipUser.id },
        }),
      )
    : []
  const outstandingDebt = transferredDebt.reduce(
    (sum, transfer) => sum + transfer.sessions - transfer.restoredSessions,
    0,
  )
  const restoredSessions = Math.min(
    sessionsToRestore,
    Math.max(
      0,
      membershipUser.membership.sessions -
        membershipUser.remainingSessions +
        outstandingDebt,
    ),
  )

  if (restoredSessions === 0) {
    return 0
  }

  if (transferredDebt.length && tx.membershipDebtTransfer) {
    await withCustomerWallet(() =>
      creditMembershipIncludingTransferredDebt(
        tx as unknown as Prisma.TransactionClient,
        membershipUser.id,
        restoredSessions,
      ),
    )
    return restoredSessions
  }

  await tx.membershipUser.update({
    where: { id: membershipUser.id },
    data: {
      remainingSessions: { increment: restoredSessions },
      isExpired: membershipUser.endDate <= new Date(),
    },
  })

  return restoredSessions
}
