import { db } from '@/lib/prisma'
import {
  settleCustomerMembershipDebt,
  withCustomerWallet,
} from './membership-renewal.service'
/** Repairs missed historic renewals as well as balances charged after a paid renewal. */
export async function reconcileMembershipDebtBalances(now = new Date()) {
  return withCustomerWallet(async () => {
    const customers = await db.membershipUser.findMany({
      where: { remainingSessions: { lt: 0 }, invoice: { status: 'PAID' } },
      distinct: ['userId'],
      select: { userId: true },
    })
    let settledSessions = 0
    const reviewRequired: string[] = []
    for (const customer of customers) {
      const result = await db.$transaction((tx) =>
        settleCustomerMembershipDebt(tx, customer.userId, now),
      )
      settledSessions += result.settledSessions
      reviewRequired.push(...result.reviewRequired)
    }
    return { customers: customers.length, settledSessions, reviewRequired }
  })
}
