import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  method: vi.fn(),
  payment: vi.fn(),
  invoice: vi.fn(),
  createPack: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...h: any[]) => h },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    membership: {
      findUnique: async () => ({
        id: 'product',
        isActive: true,
        price: 100000,
        sessions: 10,
        duration: 30,
      }),
    },
    user: { findUnique: async () => ({ id: 'customer' }) },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/utils', () => ({
  formatPhone: vi.fn(),
  generateInvoiceNumber: async () => 'INV-TEST',
}))
vi.mock('@/services/membership-renewal.service', () => ({
  applyPaidMembershipRenewal: async () => null,
}))
import { adminMembershipCheckoutHandler } from './membership.handler'
const run = (paymentMethodId?: string) =>
  (adminMembershipCheckoutHandler.at(-1) as any)({
    get: () => ({ id: 'cashier' }),
    req: {
      valid: () => ({
        membershipId: 'product',
        userId: 'customer',
        paymentMethodId,
      }),
    },
    var: { logger: { info: vi.fn(), fatal: vi.fn() } },
    json: vi.fn(),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.method.mockResolvedValue({ id: 'cash', name: 'Tunai', channel: 'CASH' })
  mocks.payment.mockResolvedValue({ id: 'payment' })
  mocks.createPack.mockResolvedValue({ id: 'pack', userId: 'customer' })
  mocks.invoice.mockResolvedValue({
    id: 'invoice',
    number: 'INV-TEST',
    total: 100000,
  })
  mocks.transaction.mockImplementation((fn) =>
    fn({
      $queryRaw: vi.fn(),
      paymentMethod: { findFirst: mocks.method },
      payment: { create: mocks.payment },
      membershipUser: { create: mocks.createPack },
      invoice: { create: mocks.invoice },
    }),
  )
})
it('requires an offline method before recording paid membership', async () => {
  await expect(run()).rejects.toThrow('Pilih metode pembayaran offline')
  expect(mocks.createPack).not.toHaveBeenCalled()
  expect(mocks.payment).not.toHaveBeenCalled()
})
it('rejects unavailable, inactive, or online payment IDs', async () => {
  mocks.method.mockResolvedValue(null)
  await expect(run('online')).rejects.toThrow('offline tidak tersedia')
  expect(mocks.method).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        OR: expect.arrayContaining([{ isOffline: true }]),
      }),
    }),
  )
  expect(mocks.createPack).not.toHaveBeenCalled()
})
it('records the offline payment with cashier audit data and links it to the paid invoice', async () => {
  await run('cash')
  expect(mocks.payment).toHaveBeenCalledWith({
    data: expect.objectContaining({
      paymentMethodId: 'cash',
      status: 'PAID',
      amount: 100000,
      fees: 0,
      meta: expect.objectContaining({
        source: 'ADMIN_MEMBERSHIP_BOOKING',
        receivedBy: 'cashier',
        methodName: 'Tunai',
      }),
    }),
  })
  expect(mocks.invoice).toHaveBeenCalledWith({
    data: expect.objectContaining({
      paymentId: 'payment',
      membershipUserId: 'pack',
      status: 'PAID',
      total: 100000,
    }),
  })
})
