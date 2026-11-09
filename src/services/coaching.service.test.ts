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
it.each([
  { ids: ['coach'], price: 150000 },
  { ids: ['ballboy'], price: 45000 },
  { ids: ['coach', 'ballboy'], price: 195000 },
])(
  'immediately confirms and pays $ids without a payment method or gateway',
  async ({ ids, price }) => {
    const result = await attachCoachingService(
      'detail',
      ids,
      'cashier',
      undefined,
      now,
    )
    expect(result).toMatchObject({ status: 'PAID', total: price })
    expect(mocks.tx.booking.create.mock.calls[0][0].data).toMatchObject({
      status: 'CONFIRMED',
      holdExpiresAt: null,
      totalPrice: price,
      processingFee: 0,
      cashierId: 'cashier',
      adminNote: expect.stringContaining('dikonfirmasi lunas oleh cashier'),
    })
    expect(mocks.tx.invoice.create.mock.calls[0][0].data).toMatchObject({
      status: 'PAID',
      total: price,
      processingFee: 0,
      paidAt: now,
    })
    for (const model of [mocks.tx.bookingCoach, mocks.tx.bookingBallboy])
      for (const [args] of model.create.mock.calls)
        expect(args.data.status).toBe('CONFIRMED')
    expect(mocks.tx.paymentMethod.findFirst).not.toHaveBeenCalled()
    expect(mocks.tx.payment.create).not.toHaveBeenCalled()
    expect(mocks.gateway).not.toHaveBeenCalled()
  },
)
it('rejects duplicate selections before claiming slots', async () => {
  await expect(
    attachCoachingService(
      'detail',
      ['coach', 'coach'],
      'cashier',
      undefined,
      now,
    ),
  ).rejects.toThrow('maksimal')
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
  ).toMatchObject({ total: 150000, status: 'PAID' })
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
it('charges the additional coach rate when attaching an adjacent hour to the same confirmed court booking', async () => {
  mocks.tx.slot.findFirst.mockResolvedValue({
    ...slots[0],
    price: 200000,
    additionalHourPrice: 100000,
  })
  mocks.tx.bookingCoach.findFirst = vi
    .fn()
    .mockResolvedValue({ id: 'previous-coach-hour' })
  const result = await attachCoachingService(
    'detail',
    ['coach'],
    'admin',
    undefined,
    now,
    { method: 'EDC', received: true },
  )
  expect(result.total).toBe(100000)
  expect(mocks.tx.bookingCoach.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ price: 100000, bookingId: 'service' }),
    }),
  )
  expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ total: 100000, subtotal: 100000 }),
    }),
  )
})
