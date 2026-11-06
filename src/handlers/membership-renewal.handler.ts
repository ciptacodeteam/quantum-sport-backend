import { planMembershipDebtSettlement } from '@/lib/membership-debt-settlement'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { NotFoundException } from '@/exceptions'
import { zValidator } from '@hono/zod-validator'
import { idSchema } from '@/lib/validation'
import { validateHook } from '@/helpers/validate-hook'
import { withCustomerWallet } from '@/services/membership-renewal.service'

export const membershipRenewalPreviewHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param')
    const user = c.get('user')!
    // The product and renewal debt belong to the shared customer wallet.
    const membership = await db.membership.findUnique({
      where: { id, isActive: true },
      select: { sport: true, sessions: true },
    })
    if (!membership) throw new NotFoundException('Paket tidak tersedia.')
    const packs = await withCustomerWallet(() =>
      db.membershipUser.findMany({
        where: {
          userId: user.id,
          membership: { sport: membership.sport },
          invoice: { status: 'PAID' },
        },
        include: {
          membership: { select: { sport: true } },
          invoice: { select: { status: true, paidAt: true } },
          debtsReceived: { select: { sessions: true } },
        },
      }),
    )
    const plan = planMembershipDebtSettlement(packs)
    const debtSessions = [...plan.balances.values()].reduce(
      (sum, balance) => sum + Math.max(0, -balance),
      0,
    )
    const reviewRequired = plan.reviewRequired.length > 0
    const debtSettledSessions = reviewRequired
      ? 0
      : Math.min(membership.sessions, debtSessions)
    return c.json(
      ok({
        packageSessions: membership.sessions,
        debtSessions,
        debtSettledSessions,
        remainingAfterPurchase: membership.sessions - debtSettledSessions,
        unsettledDebtSessions: debtSessions - debtSettledSessions,
        reviewRequired,
      }),
    )
  },
)
