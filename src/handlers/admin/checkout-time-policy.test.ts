import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  slots: vi.fn(),
  claim: vi.fn(),
  details: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ db: { $transaction: mocks.transaction } }))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/services/membership-renewal.service', () => ({
  lockCustomerWallet: vi.fn(),
}))
vi.mock('@/services/slot-claim.service', () => ({
  claimSlotsAtomically: mocks.claim,
}))
vi.mock('@/services/tariff-policy.service', () => ({
  getTariffPeriods: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/services/recurring-booking.service', () => ({
  createRecurringBooking: vi.fn(),
}))
import { adminCheckoutHandler } from './checkout.handler'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  mocks.slots.mockResolvedValue([
    {
      id: 'court-slot',
      branchId: 'cemara',
      courtId: 'court',
      court: { sport: 'PADEL' },
      startAt: new Date('2026-11-01T13:00:00Z'),
      endAt: new Date('2026-11-01T14:00:00Z'),
      isAvailable: true,
      bookingDetails: [],
      price: 150000,
      discountPrice: 0,
    },
  ])
  mocks.transaction.mockImplementation(async (fn) =>
    fn({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'customer' }) },
      slot: { findMany: mocks.slots },
      booking: { create: vi.fn().mockResolvedValue({ id: 'booking' }) },
      bookingDetail: { create: mocks.details },
    }),
  )
  // Deliberately stop after eligibility validation, before invoices or payments.
  mocks.claim.mockRejectedValue(new Error('test-stop-after-claim'))
})
afterEach(() => vi.useRealTimers())

const checkout = () =>
  (adminCheckoutHandler.at(-1) as any)(
    {
      get: () => ({ id: 'admin' }),
      req: {
        valid: () => ({
          userId: 'customer',
          totalHours: 1,
          courtSlots: ['court-slot'],
          useMembership: false,
        }),
      },
      var: { logger: { fatal: vi.fn() } },
      json: vi.fn(),
    },
    vi.fn(),
  )

it.each([
  ['2026-11-01T13:00:00+07:00', true],
  ['2026-11-01T13:14:59.999+07:00', true],
  ['2026-11-01T13:15:00+07:00', false],
  ['2026-11-01T13:30:00+07:00', false],
  ['2026-11-02T13:00:00+07:00', false],
])(
  'enforces the same grace period for direct admin checkout at %s',
  async (now, allowed) => {
    vi.setSystemTime(new Date(now))
    await expect(checkout()).rejects.toThrow(
      allowed ? 'test-stop-after-claim' : '15-minute booking grace period',
    )
    if (allowed)
      expect(mocks.claim).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          slotIds: ['court-slot'],
          type: 'COURT',
          startsAfter: new Date(Date.parse(now) + 7 * 3_600_000 - 15 * 60_000),
        }),
      )
    else expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.details).not.toHaveBeenCalled()
  },
)
