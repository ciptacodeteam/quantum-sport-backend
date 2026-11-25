import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  paymentMethod: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    membership: { findMany: mocks.list, findUnique: mocks.detail },
    paymentMethod: { findUnique: mocks.paymentMethod },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/services/midtrans.service', () => ({ midtransService: {} }))
import {
  getAllMembershipHandler,
  getMembershipHandler,
} from './membership.handler'
import { membershipCheckoutHandler } from './membership-checkout.handler'
import {
  createMembershipSchema,
  updateMembershipSchema,
} from '@/lib/validation'
const context = (body = {}) => ({
  get: () => ({ id: 'customer' }),
  req: { valid: () => body },
  json: (value: unknown) => value,
  var: { logger: { fatal: vi.fn() } },
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([])
})
it('forces the customer catalogue to include only active public packages', async () => {
  await (getAllMembershipHandler.at(-1) as any)(context())
  expect(mocks.list).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ isActive: true, isPublic: true }),
    }),
  )
})
it.each([false, true])(
  'allows direct package detail only if public: %s',
  async (isPublic) => {
    mocks.detail.mockResolvedValue({ id: 'pack', isActive: true, isPublic })
    const result = (getMembershipHandler.at(-1) as any)(context({ id: 'pack' }))
    if (isPublic) expect((await result).data.id).toBe('pack')
    else await expect(result).rejects.toThrow('not found')
  },
)
it('rejects a direct customer checkout for a private active package before payment or writes', async () => {
  mocks.detail.mockResolvedValue({
    id: 'private',
    isActive: true,
    isPublic: false,
  })
  await expect(
    (membershipCheckoutHandler.at(-1) as any)(
      context({ membershipId: 'private', paymentMethodId: 'online' }),
    ),
  ).rejects.toThrow('hanya dapat dipesan melalui admin')
  expect(mocks.paymentMethod).not.toHaveBeenCalled()
  expect(mocks.transaction).not.toHaveBeenCalled()
})
it('accepts explicit visibility booleans without coercing the string false to true', () => {
  const data = { name: 'Pack', price: 1000000, sessions: 10, duration: 30 }
  expect(
    createMembershipSchema.parse({ ...data, isPublic: false }).isPublic,
  ).toBe(false)
  expect(
    createMembershipSchema.parse({ ...data, isPublic: true }).isPublic,
  ).toBe(true)
  expect(
    createMembershipSchema.safeParse({ ...data, isPublic: 'false' }).success,
  ).toBe(false)
  expect(updateMembershipSchema.parse({ isPublic: false }).isPublic).toBe(false)
  expect(updateMembershipSchema.parse({})).not.toHaveProperty('isPublic')
})
