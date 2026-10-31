import type { Prisma } from '@prisma/client'
import { branchContext } from '@/lib/branch-context'

type Tx = Prisma.TransactionClient

/** The wallet is shared across branches. Only trusted payment/usage code calls this. */
export function withCustomerWallet<T>(callback: () => Promise<T>): Promise<T> {
  return branchContext.exit(async () => await callback())
}

/** Serialize all renewals and deferred usage for the same customer, across branches. */
export async function lockCustomerWallet(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`
}

/** Call inside the transaction that records payment, never during unpaid checkout. */
export async function applyPaidMembershipRenewal(
  tx: Tx,
  membershipUserId: string,
  now = new Date(),
) {
  return withCustomerWallet(async () => {
    const identity = await tx.membershipUser.findUnique({
      where: { id: membershipUserId },
      select: { userId: true },
    })
    if (!identity) return null
    await lockCustomerWallet(tx, identity.userId)
    const target = await tx.membershipUser.findUnique({
      where: { id: membershipUserId },
      include: {
        membership: { select: { sport: true } },
        invoice: { select: { status: true } },
      },
    })
    if (!target || target.invoice?.status !== 'PAID') return null
    if (target.renewalAppliedAt) return target

    const previous = await tx.membershipUser.findMany({
      where: {
        userId: target.userId,
        id: { not: target.id },
        membership: { sport: target.membership.sport },
        invoice: { status: 'PAID' },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    let debt = 0
    for (const source of previous) {
      if (source.remainingSessions >= 0) continue
      const sessions = -source.remainingSessions
      await tx.membershipDebtTransfer.create({
        data: {
          fromMembershipUserId: source.id,
          toMembershipUserId: target.id,
          sessions,
        },
      })
      await tx.membershipUser.update({
        where: { id: source.id },
        data: { remainingSessions: { increment: sessions }, isExpired: true },
      })
      debt += sessions
    }
    await tx.membershipUser.updateMany({
      where: {
        id: {
          in: previous
            .filter((pack) => pack.remainingSessions === 0)
            .map((pack) => pack.id),
        },
      },
      data: { isExpired: true },
    })
    const updated = await tx.membershipUser.update({
      where: { id: target.id },
      data: {
        remainingSessions: { decrement: debt },
        debtSettledSessions: debt,
        renewalAppliedAt: now,
      },
    })
    // Include stopped/completed rules: their already reserved sessions still need the new payer.
    // Do not reactivate them or change their schedules/stop dates.
    const previousIds = previous.map((pack) => pack.id)
    if (previousIds.length)
      await tx.recurringBooking.updateMany({
        where: { userId: target.userId, membershipUserId: { in: previousIds } },
        data: { membershipUserId: target.id },
      })
    return updated
  })
}

/** Refund the debt-funded portion to its current package, retaining the old paid quota. */
export async function creditMembershipIncludingTransferredDebt(
  tx: Tx,
  membershipUserId: string,
  sessions: number,
  now = new Date(),
): Promise<void> {
  if (sessions <= 0) return
  const transfers = await tx.membershipDebtTransfer.findMany({
    where: { fromMembershipUserId: membershipUserId },
    orderBy: { createdAt: 'asc' },
  })
  let remainder = sessions
  for (const transfer of transfers) {
    const forwarded = Math.min(
      remainder,
      transfer.sessions - transfer.restoredSessions,
    )
    if (forwarded <= 0) continue
    await tx.membershipDebtTransfer.update({
      where: { id: transfer.id },
      data: { restoredSessions: { increment: forwarded } },
    })
    await creditMembershipIncludingTransferredDebt(
      tx,
      transfer.toMembershipUserId,
      forwarded,
      now,
    )
    remainder -= forwarded
  }
  if (remainder > 0) {
    const pack = await tx.membershipUser.findUniqueOrThrow({
      where: { id: membershipUserId },
    })
    await tx.membershipUser.update({
      where: { id: membershipUserId },
      data: {
        remainingSessions: { increment: remainder },
        isExpired: pack.endDate <= now,
      },
    })
  }
}

/** A routine can span several packages; refund exactly the ledger entries charged to each. */
export async function restoreRecurringMembershipDebits(
  tx: Tx,
  bookingId: string,
  now = new Date(),
) {
  return withCustomerWallet(async () => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        userId: true,
        recurringOccurrences: { take: 1, select: { id: true } },
      },
    })
    if (!booking?.recurringOccurrences.length) return null
    await lockCustomerWallet(tx, booking.userId)
    const debits = await tx.membershipSessionDebit.findMany({
      where: { detail: { bookingId }, reversedAt: null },
    })
    let restored = 0
    for (const debit of debits) {
      await tx.membershipSessionDebit.update({
        where: { id: debit.id },
        data: { reversedAt: now },
      })
      await creditMembershipIncludingTransferredDebt(
        tx,
        debit.membershipUserId,
        debit.sessions,
        now,
      )
      restored += debit.sessions
    }
    return restored
  })
}
