import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), aggregate: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    membership: { findUnique: mocks.findUnique },
    membershipUser: { aggregate: mocks.aggregate },
  },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
import { membershipRenewalPreviewHandler } from './membership-renewal.handler'
type PreviewHandler = (context: unknown) => Promise<{ data: { packageSessions: number; debtSessions: number; remainingAfterPurchase: number } }>
beforeEach(() => vi.clearAllMocks())
it('quotes only the signed-in customer debt in the product sport and leaves payment to checkout', async () => {
  mocks.findUnique.mockResolvedValue({ sport: 'PADEL', sessions: 10 })
  mocks.aggregate.mockResolvedValue({ _sum: { remainingSessions: -2 } })
  const result = await (membershipRenewalPreviewHandler.at(-1) as unknown as PreviewHandler)({
    req: { valid: () => ({ id: 'product' }) },
    get: () => ({ id: 'customer' }),
    json: (body: unknown) => body,
  })
  expect(mocks.aggregate).toHaveBeenCalledWith({
    where: {
      userId: 'customer',
      membership: { sport: 'PADEL' },
      remainingSessions: { lt: 0 },
      invoice: { status: 'PAID' },
    },
    _sum: { remainingSessions: true },
  })
  expect(result.data).toEqual({
    packageSessions: 10,
    debtSessions: 2,
    remainingAfterPurchase: 8,
  })
})
it('shows a negative estimate if a smaller package cannot cover the debt', async () => {
  mocks.findUnique.mockResolvedValue({ sport: 'PADEL', sessions: 1 })
  mocks.aggregate.mockResolvedValue({ _sum: { remainingSessions: -2 } })
  const result = await (membershipRenewalPreviewHandler.at(-1) as unknown as PreviewHandler)({
    req: { valid: () => ({ id: 'product' }) },
    get: () => ({ id: 'customer' }),
    json: (body: unknown) => body,
  })
  expect(result.data.remainingAfterPurchase).toBe(-1)
})
