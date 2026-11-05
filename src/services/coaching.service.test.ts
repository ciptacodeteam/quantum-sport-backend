import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  tx: {} as any,
  gateway: vi.fn(),
  claim: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: { $transaction: (fn: any) => fn(mocks.tx) },
}))
vi.mock('@/lib/utils', () => ({
  generateInvoiceNumber: async () => 'INV-SERVICE',
}))
vi.mock('./slot-claim.service', () => ({ claimSlotsAtomically: mocks.claim }))
vi.mock('./midtrans.service', () => ({
  midtransService: { initiateCheckoutPayment: mocks.gateway },
  isSupportedChannel: (channel: string) => channel === 'BCA_VIRTUAL_ACCOUNT',
  isPaidStatus: () => false,
}))
vi.mock('./payment-reconcile.service', () => ({
  finalizeSuccessfulPayment: vi.fn(),
}))
import { attachCoachingService } from './coaching.service'
import { withBranchContext, branchContext } from '@/lib/branch-context'
import { scopeBranchOperation } from '@/lib/branch-scope'
const now = new Date('2026-11-01T05:00:00Z')
const startAt = new Date('2026-11-02T13:00:00Z')
const endAt = new Date('2026-11-02T14:00:00Z')
const slots = [
  {
    id: 'coach',
    branchId: 'cemara',
    type: 'COACH',
    price: 150000,
    startAt,
    endAt,
    staffId: 'staff-c',
    staff: {
      name: 'Coach',
      role: 'COACH',
      coachType: 'TENNIS',
      isActive: true,
    },
  },
  {
    id: 'ballboy',
    branchId: 'cemara',
    type: 'BALLBOY',
    price: 45000,
    startAt,
    endAt,
    staffId: 'staff-b',
    staff: { name: 'Ballboy', role: 'BALLBOY', isActive: true },
  },
]
beforeEach(() => {
  vi.clearAllMocks()
  mocks.claim.mockResolvedValue(undefined)
  mocks.tx = {
    $queryRaw: vi.fn(),
    bookingDetail: {
      findFirst: vi.fn().mockResolvedValue({
        slotId: 'court-slot',
        bookingId: 'court-booking',
        slot: { startAt, endAt, court: { name: 'Tennis', sport: 'TENNIS' } },
        booking: {
          status: 'CONFIRMED',
          branchId: 'cemara',
          userId: 'customer',
        },
      }),
    },
    slot: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }) =>
          slots.filter((s) => where.id.in.includes(s.id)),
        ),
      findFirst: vi
        .fn()
        .mockImplementation(({ where }) =>
          slots.find((s) => s.id === where.id),
        ),
    },
    booking: { create: vi.fn().mockResolvedValue({ id: 'service' }) },
    bookingCoach: { create: vi.fn() },
    bookingBallboy: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    bookingCoachType: { findFirst: vi.fn().mockResolvedValue({ id: 'type' }) },
    paymentMethod: {
      upsert: vi
        .fn()
        .mockRejectedValue(
          new Error('Hanya super admin yang dapat mengubah katalog bersama.'),
        ),
      findFirst: vi.fn().mockImplementation(async (args) => {
        const context = branchContext.getStore()
        if (context)
          await scopeBranchOperation(
            {},
            'PaymentMethod',
            'findFirst',
            args,
            context,
          )
        return args.where.channel
          ? {
              id: 'manual',
              isActive: true,
              channel: args.where.channel,
              fees: 0,
              percentage: 0,
            }
          : {
              id: 'va',
              isActive: true,
              channel: 'BCA_VIRTUAL_ACCOUNT',
              fees: 4000,
              percentage: 1,
            }
      }),
    },
    invoice: {
      create: vi
        .fn()
        .mockImplementation(({ data }) => ({ ...data, id: 'invoice' })),
      update: vi.fn(),
    },
    payment: { create: vi.fn().mockResolvedValue({ id: 'payment' }) },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Customer' }),
    },
  }
  mocks.gateway.mockResolvedValue({
    mode: 'snap',
    orderId: 'invoice',
    meta: {},
  })
})
it.each(
  (['EDC', 'QRIS_STATIC', 'BANK_TRANSFER_MANUAL'] as const).flatMap((method) =>
    ['ADMIN', 'CASHIER'].map((role) => ({ method, role })),
  ),
)(
  'records a paid $method invoice for $role without shared catalog writes',
  async ({ method, role }) => {
    const result = await withBranchContext(
      { branchId: 'cemara', isAdmin: true, isSuperAdmin: false, staffId: role },
      () =>
        attachCoachingService(
          'detail',
          ['coach', 'ballboy'],
          'admin',
          undefined,
          now,
          { method, received: true },
        ),
    )
    expect(mocks.tx.paymentMethod.findFirst).toHaveBeenCalledWith({
      where: { channel: method, isActive: true },
      orderBy: { sequence: 'asc' },
    })
    expect(mocks.tx.paymentMethod.upsert).not.toHaveBeenCalled()
    expect(result).toMatchObject({ total: 195000, status: 'PAID' })
    expect(mocks.tx.booking.create).toHaveBeenCalledOnce()
    expect(mocks.tx.booking.create.mock.calls[0][0].data).toMatchObject({
      status: 'CONFIRMED',
      holdExpiresAt: null,
      totalPrice: 195000,
      processingFee: 0,
    })
    expect(mocks.tx.bookingCoach.create.mock.calls[0][0].data).toMatchObject({
      bookingId: 'service',
      status: 'CONFIRMED',
      price: 150000,
    })
    expect(mocks.tx.bookingBallboy.create.mock.calls[0][0].data).toMatchObject({
      bookingId: 'service',
      status: 'CONFIRMED',
      price: 45000,
    })
    expect(mocks.tx.payment.create.mock.calls[0][0].data).toMatchObject({
      status: 'PAID',
      amount: 195000,
      fees: 0,
      paidAt: now,
      meta: { receivedBy: 'admin', channel: method },
    })
    expect(mocks.tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice' },
      data: { paymentId: 'payment' },
    })
    expect(mocks.gateway).not.toHaveBeenCalled()
  },
)
it('charges gateway fees once for the combined invoice and retains the unpaid hold', async () => {
  const result = await attachCoachingService(
    'detail',
    ['coach', 'ballboy'],
    'admin',
    'va',
    now,
  )
  expect(result).toMatchObject({ total: 201605, status: 'PENDING' })
  expect(mocks.gateway).toHaveBeenCalledOnce()
  expect(mocks.tx.booking.create.mock.calls[0][0].data.status).toBe('HOLD')
  expect(mocks.tx.payment.create.mock.calls[0][0].data.status).toBe('PENDING')
})
it('rejects an unconfirmed manual payment before claiming slots', async () => {
  await expect(
    attachCoachingService('detail', ['coach'], 'admin', undefined, now, {
      method: 'EDC',
      received: false,
    }),
  ).rejects.toThrow('Konfirmasi')
  expect(mocks.claim).not.toHaveBeenCalled()
})
it('rejects duplicate selections and incompatible methods', async () => {
  await expect(
    attachCoachingService(
      'detail',
      ['coach', 'coach'],
      'admin',
      undefined,
      now,
    ),
  ).rejects.toThrow('maksimal')
  await expect(
    attachCoachingService('detail', ['coach'], 'admin', 'va', now, {
      method: 'EDC',
      received: true,
    }),
  ).rejects.toThrow('Konfirmasi')
  expect(mocks.claim).not.toHaveBeenCalled()
})
it('propagates a failed second claim without creating partial billing records', async () => {
  mocks.claim
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Slot sudah dibooking'))
  await expect(
    attachCoachingService('detail', ['coach', 'ballboy'], 'admin', 'va', now),
  ).rejects.toThrow('sudah dibooking')
  expect(mocks.tx.booking.create).not.toHaveBeenCalled()
  expect(mocks.tx.invoice.create).not.toHaveBeenCalled()
  expect(mocks.gateway).not.toHaveBeenCalled()
})
it('preserves the legacy single-slot caller', async () => {
  expect(
    await attachCoachingService('detail', 'coach', 'admin', 'va', now),
  ).toMatchObject({ total: 156105, status: 'PENDING' })
})

it('keeps the shared catalog protected for non-super admins', async () => {
  await withBranchContext(
    { branchId: 'cemara', isAdmin: true, isSuperAdmin: false },
    async () => {
      await expect(
        scopeBranchOperation(
          {},
          'PaymentMethod',
          'upsert',
          { where: { name: 'EDC' }, create: {}, update: {} },
          branchContext.getStore()!,
        ),
      ).rejects.toThrow('Hanya super admin')
    },
  )
})
it('fails clearly without creating billing records when a manual method is missing or disabled', async () => {
  mocks.tx.paymentMethod.findFirst.mockResolvedValueOnce(null)
  await expect(
    attachCoachingService('detail', ['coach'], 'admin', undefined, now, {
      method: 'BANK_TRANSFER_MANUAL',
      received: true,
    }),
  ).rejects.toThrow('Hubungi Super Admin')
  expect(mocks.tx.paymentMethod.upsert).not.toHaveBeenCalled()
  expect(mocks.tx.booking.create).not.toHaveBeenCalled()
  expect(mocks.tx.invoice.create).not.toHaveBeenCalled()
})

it('settles a custom offline catalog method only after receipt confirmation, without gateway fees', async () => {
  mocks.tx.paymentMethod.findFirst.mockResolvedValue({
    id: 'cash',
    isActive: true,
    isOffline: true,
    channel: null,
    fees: 5000,
    percentage: 2,
  })
  const result = await attachCoachingService(
    'detail',
    ['coach'],
    'admin',
    'cash',
    now,
    { received: true },
  )
  expect(mocks.tx.paymentMethod.findFirst).toHaveBeenCalledWith({
    where: { id: 'cash', isOffline: true, isActive: true },
    orderBy: { sequence: 'asc' },
  })
  expect(result).toMatchObject({ total: 150000, status: 'PAID' })
  expect(mocks.tx.payment.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        paymentMethodId: 'cash',
        status: 'PAID',
        fees: 0,
        meta: expect.objectContaining({ channel: 'OFFLINE' }),
      }),
    }),
  )
  expect(mocks.gateway).not.toHaveBeenCalled()
})
it('does not send an offline catalog method to the online gateway without receipt confirmation', async () => {
  mocks.tx.paymentMethod.findFirst.mockResolvedValue({
    id: 'cash',
    isActive: true,
    isOffline: true,
    channel: 'QRIS',
    fees: 0,
    percentage: 0,
  })
  await expect(
    attachCoachingService('detail', ['coach'], 'admin', 'cash', now),
  ).rejects.toThrow('metode pembayaran layanan')
  expect(mocks.gateway).not.toHaveBeenCalled()
})
