import {
  compareMembershipPurchases,
  planMembershipDebtSettlement,
} from '@/lib/membership-debt-settlement'
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

/** Reconcile current paid balances under the same customer lock; never reset package dates. */
export async function settleCustomerMembershipDebt(
  tx: Tx,
  userId: string,
  now = new Date(),
) {
  return withCustomerWallet(async () => {
    await lockCustomerWallet(tx, userId)
    const packs = await tx.membershipUser.findMany({
      where: { userId, invoice: { status: 'PAID' } },
      include: {
        membership: { select: { sport: true } },
        invoice: { select: { status: true, paidAt: true } },
        debtsReceived: { select: { sessions: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const plan = planMembershipDebtSettlement(packs, now)
    const reroute = new Map<string, string>()
    for (const transfer of plan.transfers) {
      const { fromMembershipUserId, toMembershipUserId, sessions } = transfer
      const payer = await tx.membershipUser.update({
        where: {
          id: toMembershipUserId,
          userId,
          remainingSessions: { gte: sessions },
          isExpired: false,
          isSuspended: false,
          endDate: { gt: now },
          invoice: { status: 'PAID' },
        },
        data: {
          remainingSessions: { decrement: sessions },
          debtSettledSessions: { increment: sessions },
        },
      })
      if (payer.remainingSessions === 0)
        await tx.membershipUser.update({
          where: { id: payer.id },
          data: { isExpired: true },
        })
      await tx.membershipUser.update({
        where: {
          id: fromMembershipUserId,
          userId,
          remainingSessions: { lte: -sessions },
          invoice: { status: 'PAID' },
        },
        data: { remainingSessions: { increment: sessions }, isExpired: true },
      })
      await tx.membershipDebtTransfer.upsert({
        where: {
          fromMembershipUserId_toMembershipUserId: {
            fromMembershipUserId,
            toMembershipUserId,
          },
        },
        create: transfer,
        update: { sessions: { increment: sessions } },
      })
      reroute.set(fromMembershipUserId, toMembershipUserId)
    }
    for (const [from, to] of reroute)
      await tx.recurringBooking.updateMany({
        where: { userId, membershipUserId: from },
        data: { membershipUserId: to },
      })
    return {
      settledSessions: plan.transfers.reduce(
        (sum, row) => sum + row.sessions,
        0,
      ),
      transfers: plan.transfers,
      reviewRequired: plan.reviewRequired,
    }
  })
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
        invoice: { select: { status: true, paidAt: true } },
      },
    })
    if (!target || target.invoice?.status !== 'PAID') return null
    await settleCustomerMembershipDebt(tx, target.userId, now)
    if (target.renewalAppliedAt)
      return tx.membershipUser.findUnique({
        where: { id: target.id },
        include: {
          membership: { select: { sport: true } },
          invoice: { select: { status: true, paidAt: true } },
        },
      })

    const previousCandidates = await tx.membershipUser.findMany({
      where: {
        userId: target.userId,
        id: { not: target.id },
        membership: { sport: target.membership.sport },
        invoice: { status: 'PAID' },
      },
      include: { invoice: { select: { status: true, paidAt: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const previous = previousCandidates.filter(
      (pack) => compareMembershipPurchases(pack, target) < 0,
    )
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
