import { db } from '../src/lib/prisma'
import { planMembershipDebtSettlement } from '../src/lib/membership-debt-settlement'
import { reconcileMembershipDebtBalances } from '../src/services/membership-debt-reconciliation.service'
import { withCustomerWallet } from '../src/services/membership-renewal.service'
// Preview by default. --apply is explicit, atomic per customer, and safe to repeat.
try {
  if (process.argv.includes('--apply')) {
    console.log(
      JSON.stringify(await reconcileMembershipDebtBalances(), null, 2),
    )
  } else {
    const packs = await withCustomerWallet(() =>
      db.membershipUser.findMany({
        where: { invoice: { status: 'PAID' } },
        include: {
          membership: { select: { sport: true } },
          invoice: { select: { status: true, paidAt: true } },
          debtsReceived: { select: { sessions: true } },
        },
      }),
    )
    const plan = planMembershipDebtSettlement(packs)
    console.log(
      JSON.stringify(
        {
          mode: 'preview',
          transfers: plan.transfers,
          reviewRequired: plan.reviewRequired,
          balances: Object.fromEntries(plan.balances),
        },
        null,
        2,
      ),
    )
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Debt reconciliation failed',
  )
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
