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
    const debt = await withCustomerWallet(() =>
      db.membershipUser.aggregate({
        where: {
          userId: user.id,
          membership: { sport: membership.sport },
          remainingSessions: { lt: 0 },
          invoice: { status: 'PAID' },
        },
        _sum: { remainingSessions: true },
      }),
    )
    const debtSessions = -(debt._sum.remainingSessions ?? 0)
    return c.json(
      ok({
        packageSessions: membership.sessions,
        debtSessions,
        remainingAfterPurchase: membership.sessions - debtSessions,
      }),
    )
  },
)
