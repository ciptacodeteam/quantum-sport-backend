import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: any[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    membership: {
      findUnique: async () => ({ id: 'membership', isActive: true }),
    },
    paymentMethod: {
      findUnique: async () => ({
        id: 'method',
        isActive: true,
        isOffline: true,
        channel: 'QRIS',
      }),
    },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/services/midtrans.service', () => ({ midtransService: {} }))
import { membershipCheckoutHandler } from './membership-checkout.handler'
it('rejects offline payment IDs before creating customer membership or payment records', async () => {
  const context = {
    get: () => ({ id: 'customer' }),
    req: {
      valid: () => ({ membershipId: 'membership', paymentMethodId: 'method' }),
    },
    var: { logger: { fatal: vi.fn(), error: vi.fn() } },
    json: vi.fn(),
  }
  await expect(
    (membershipCheckoutHandler.at(-1) as any)(context),
  ).rejects.toThrow('offline hanya tersedia melalui admin')
  expect(mocks.transaction).not.toHaveBeenCalled()
})
