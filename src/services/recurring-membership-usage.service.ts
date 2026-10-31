import {
  lockCustomerWallet,
  withCustomerWallet,
} from './membership-renewal.service'
import { db } from '@/lib/prisma'
import { withBranchContext } from '@/lib/branch-context'
import { calculateMembershipSessionsForCourtSlots } from './membership-booking.service'

/** One ledger entry per slot makes retries and concurrent workers charge exactly once. */
export async function chargeDueRecurringMembershipSessions(now = new Date()) {
  const due = await db.bookingDetail.findMany({
    where: {
      membershipDebit: null,
      slot: { startAt: { lte: now } },
      booking: {
        status: 'CONFIRMED',
        membershipUserId: { not: null },
        recurringOccurrences: { some: {} },
      },
    },
    select: {
      id: true,
      bookingId: true,
      booking: { select: { branchId: true, userId: true } },
    },
  })
  for (const candidate of due) {
    await withBranchContext(
      {
        branchId: candidate.booking.branchId,
        isAdmin: true,
        isSuperAdmin: true,
      },
      () =>
        db.$transaction(async (tx) => {
          await lockCustomerWallet(tx, candidate.booking.userId)
          // Cancellation also updates this row; whichever gets the lock first wins.
          await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${candidate.bookingId} FOR UPDATE`
          const detail = await tx.bookingDetail.findUnique({
            where: { id: candidate.id },
            include: {
              membershipDebit: true,
              slot: true,
              booking: {
                include: {
                  recurringOccurrences: {
                    take: 1,
                    include: { series: { select: { membershipUserId: true } } },
                  },
                },
              },
            },
          })
          if (
            !detail ||
            detail.membershipDebit ||
            detail.booking.status !== 'CONFIRMED' ||
            !detail.booking.membershipUserId ||
            detail.slot.startAt > now
          )
            return
          const sessions = calculateMembershipSessionsForCourtSlots([
            detail.slot,
          ])
          if (!sessions) return
          const membershipUserId =
            detail.booking.recurringOccurrences[0]?.series.membershipUserId ??
            detail.booking.membershipUserId
          await withCustomerWallet(() =>
            tx.membershipSessionDebit.create({
              data: {
                branchId: detail.booking.branchId,
                detailId: detail.id,
                membershipUserId,
                sessions,
                chargedAt: now,
              },
            }),
          )
          // Negative balances and an elapsed membership endDate do not stop an existing rule.
          await withCustomerWallet(() =>
            tx.membershipUser.update({
              where: { id: membershipUserId },
              data: { remainingSessions: { decrement: sessions } },
            }),
          )
          await tx.booking.update({
            where: { id: detail.bookingId },
            data: { membershipSessionsUsed: { increment: sessions } },
          })
        }),
    )
  }
  return due.length
}
