import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  tx: {} as any,
  rules: [] as any[],
  payload: {} as any,
}))
vi.mock('@/lib/prisma', () => ({
  db: { $transaction: (fn: any) => fn(mocks.tx) },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: any[]) => handlers },
}))
vi.mock('@/services/membership-renewal.service', () => ({
  lockCustomerWallet: vi.fn(),
}))
vi.mock('@/services/slot-claim.service', () => ({
  claimSlotsAtomically: vi.fn(),
}))
vi.mock('@/services/coach-booking-conflict.service', () => ({
  assertCoachSlotsDoNotConflict: vi.fn(),
}))
vi.mock('@/services/tariff-policy.service', () => ({
  getTariffPeriods: async () => mocks.rules,
}))
vi.mock('@/services/recurring-booking.service', () => ({
  createRecurringBooking: vi.fn(),
}))
vi.mock('@/lib/utils', () => ({
  generateInvoiceNumber: async () => 'INV-ADMIN-TEST',
}))
import { adminCheckoutHandler } from './checkout.handler'
const range = {
  startAt: new Date('2040-01-02T10:00:00Z'),
  endAt: new Date('2040-01-02T11:00:00Z'),
}
beforeEach(() => {
  vi.clearAllMocks()
  const court = {
    ...range,
    id: 'court-slot',
    branchId: 'cemara',
    courtId: 'court',
    court: { sport: 'PADEL' },
    price: 150000,
    discountPrice: 0,
    bookingDetails: [],
  }
  const coach = {
    ...range,
    id: 'coach-slot',
    staff: { coachType: 'PADEL' },
    price: 200000,
    bookingCoaches: [],
  }
  mocks.rules = [
    {
      branchId: 'cemara',
      sport: 'PADEL',
      effectiveFrom: '2039-01-01',
      happyStart: 6,
      happyEnd: 15,
      peakStart: 15,
      peakEnd: 24,
      happyCoachDiscount: 45000,
      peakCoachDiscount: 25000,
    },
  ]
  mocks.payload = {
    userId: 'customer',
    totalHours: 1,
    courtSlots: ['court-slot'],
    coachSlots: ['coach-slot'],
    useMembership: false,
  }
  mocks.tx = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'customer' }) },
    slot: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }) =>
          where.type === 'COACH' ? [coach] : [court],
        ),
    },
    booking: {
      create: vi.fn().mockResolvedValue({ id: 'booking' }),
      update: vi.fn(),
    },
    bookingDetail: {
      create: vi.fn(),
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'detail', discountPrice: 150000 }),
      update: vi.fn(),
    },
    bookingCoachType: { findFirst: vi.fn().mockResolvedValue({ id: 'type' }) },
    bookingCoach: { create: vi.fn() },
    invoice: { create: vi.fn().mockResolvedValue({ id: 'invoice' }) },
  }
})
async function checkout() {
  const json = vi.fn()
  await (adminCheckoutHandler.at(-1) as any)(
    {
      get: () => ({ id: 'admin' }),
      req: { valid: () => mocks.payload },
      var: { logger: { info: vi.fn(), warn: vi.fn(), fatal: vi.fn() } },
      json,
    },
    vi.fn(),
  )
  return json
}
it('persists the configured discount in court detail, booking totals and invoice in one admin checkout', async () => {
  const json = await checkout()
  expect(mocks.tx.bookingDetail.update).toHaveBeenCalledWith({
    where: { id: 'detail' },
    data: { discountPrice: { decrement: 45000 } },
  })
  expect(mocks.tx.booking.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        totalPrice: 305000,
        courtDiscountPrice: 105000,
      }),
    }),
  )
  expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ total: 305000 }),
    }),
  )
  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({ success: true }),
    200,
  )
})
it('charges the normal court amount when no coach is selected or the configured amount is zero', async () => {
  mocks.payload.coachSlots = []
  await checkout()
  expect(mocks.tx.bookingDetail.update).not.toHaveBeenCalled()
  expect(mocks.tx.booking.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ totalPrice: 150000 }),
    }),
  )
  mocks.payload.coachSlots = ['coach-slot']
  mocks.rules[0].happyCoachDiscount = 0
  await checkout()
  expect(mocks.tx.bookingDetail.update).not.toHaveBeenCalled()
  expect(mocks.tx.booking.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ totalPrice: 350000 }),
    }),
  )
})
it('caps the coaching discount at the paid court price', async () => {
  mocks.rules[0].happyCoachDiscount = 500000
  await checkout()
  expect(mocks.tx.bookingDetail.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { discountPrice: { decrement: 150000 } } }),
  )
  expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ total: 200000 }),
    }),
  )
})
