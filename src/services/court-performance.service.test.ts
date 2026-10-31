import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  courts: vi.fn(),
  slots: vi.fn(),
  bookings: vi.fn(),
  rules: vi.fn(),
  packages: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    court: { findMany: mocks.courts },
    slot: { findMany: mocks.slots },
    booking: { findMany: mocks.bookings },
    membership: { findMany: mocks.packages },
  },
}))
vi.mock('./tariff-policy.service', () => ({ getTariffPeriods: mocks.rules }))
import {
  courtPayment,
  getCourtPerformance,
  intervalHours,
  type PerformanceBooking,
} from './court-performance.service'
const court = {
  id: 'court-1',
  name: 'Court 1',
  sport: 'PADEL',
  branchId: 'cemara',
  isActive: true,
  bookingWindowMonths: null,
}
const slot = (id: string, hour: number, available = false) => ({
  id,
  courtId: court.id,
  court,
  startAt: new Date(`2026-10-01T${String(hour).padStart(2, '0')}:00:00+07:00`),
  endAt: new Date(
    `2026-10-01T${String(hour + 1).padStart(2, '0')}:00:00+07:00`,
  ),
  isAvailable: available,
  scheduleClosed: false,
})
const booking = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'b1',
    user: { name: 'Customer' },
    invoice: { id: 'i1', number: 'INV-1', status: 'PAID' },
    membershipUserId: null,
    membershipUser: null,
    courtDiscountPrice: 200000,
    totalPrice: 200000,
    promoDiscountAmount: 0,
    recurringOccurrences: [],
    createdAt: new Date('2026-09-30T00:00:00Z'),
    details: [
      {
        id: 'd1',
        slotId: 's1',
        price: 200000,
        discountPrice: 200000,
        slot: slot('s1', 6),
      },
    ],
    ...overrides,
  }) as unknown as PerformanceBooking
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-01T06:30:00+07:00'))
  vi.clearAllMocks()
  mocks.courts.mockResolvedValue([court])
  mocks.slots.mockResolvedValue([
    slot('s1', 6),
    slot('s2', 7, true),
    { ...slot('s3', 8, false), scheduleClosed: true },
  ])
  mocks.bookings.mockResolvedValue([booking()])
  mocks.rules.mockResolvedValue([])
  mocks.packages.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())
it('merges overlapping intervals and clips to the requested reporting period', () => {
  expect(
    intervalHours(
      [
        { startAt: new Date(0), endAt: new Date(7200000) },
        { startAt: new Date(3600000), endAt: new Date(10800000) },
      ],
      new Date(1800000),
      new Date(9000000),
    ),
  ).toBe(2)
})
it('allocates order promo to courts only and excludes unpaid invoices', () => {
  const b = booking({
    courtDiscountPrice: 200000,
    totalPrice: 270000,
    promoDiscountAmount: 30000,
  })
  expect(courtPayment(b)).toBe(180000)
  expect(
    courtPayment({ ...b, invoice: { ...b.invoice!, status: 'PENDING' } }),
  ).toBe(0)
})
it('uses WIB playing dates, excludes closures, counts occupied slots even when unavailable', async () => {
  const report = await getCourtPerformance('2026-10-01', '2026-10-01')
  expect(mocks.bookings.mock.calls[0][0].where.status).toBe('CONFIRMED')
  expect(mocks.slots.mock.calls[0][0].where.startAt.lt).toEqual(
    new Date('2026-10-01T17:00:00Z'),
  )
  expect(report.summary).toMatchObject({
    hours: 1,
    pastHours: 0.5,
    upcomingHours: 0.5,
    capacityHours: 2,
    occupancy: 50,
    paidRevenue: 200000,
    realizedRevenue: 100000,
    bookings: 1,
  })
})
it('allocates paid package purchase value and keeps cash revenue separate', async () => {
  mocks.bookings.mockResolvedValue([
    booking({
      membershipUserId: 'mu',
      courtDiscountPrice: 0,
      totalPrice: 0,
      membershipUser: {
        membershipId: 'pack',
        membership: { name: '50-hour', sessions: 50 },
        invoice: { status: 'PAID', total: 5100000, processingFee: 100000 },
      },
    }),
  ])
  const report = await getCourtPerformance('2026-10-01', '2026-10-01')
  expect(report.summary).toMatchObject({
    membershipHours: 1,
    nonMembershipHours: 0,
    paidRevenue: 0,
    membershipAllocation: 100000,
    revenue: 100000,
  })
  expect(report.rows[0].categoryId).toBe('membership:pack')
})
it('does not spread payment for courts outside the selected court into selected rows', async () => {
  mocks.bookings.mockResolvedValue([
    booking({
      courtDiscountPrice: 400000,
      totalPrice: 400000,
      details: [
        {
          id: 'd1',
          slotId: 's1',
          price: 200000,
          discountPrice: 200000,
          slot: slot('s1', 6),
        },
        {
          id: 'd2',
          slotId: 'other',
          price: 200000,
          discountPrice: 200000,
          slot: {
            ...slot('other', 6),
            court: { ...court, id: 'court-2' },
            courtId: 'court-2',
          },
        },
      ],
    }),
  ])
  const report = await getCourtPerformance(
    '2026-10-01',
    '2026-10-01',
    'court-1',
  )
  expect(report.summary.paidRevenue).toBe(200000)
  expect(report.rows).toHaveLength(1)
})
it('separates membership and regular details in the same booking without counting the booking twice', async () => {
  const base = booking()
  mocks.bookings.mockResolvedValue([
    booking({
      membershipUserId: 'mu',
      membershipUser: {
        membershipId: 'pack',
        membership: { name: 'Pack', sessions: 50 },
        invoice: { status: 'PAID', total: 5000000, processingFee: 0 },
      },
      details: [
        { ...base.details[0], discountPrice: 0 },
        { ...base.details[0], id: 'd2', slotId: 's2', slot: slot('s2', 7) },
      ],
    }),
  ])
  const report = await getCourtPerformance('2026-10-01', '2026-10-01')
  expect(report.summary).toMatchObject({
    membershipHours: 1,
    nonMembershipHours: 1,
    bookings: 1,
    paidRevenue: 200000,
    membershipAllocation: 100000,
  })
  expect(
    report.categories
      .filter((c) => c.bookings)
      .reduce((s, c) => s + c.bookings, 0),
  ).toBe(2)
})
it('surfaces membership hours without a paid purchase instead of inventing a rate', async () => {
  mocks.bookings.mockResolvedValue([
    booking({
      membershipUserId: 'mu',
      courtDiscountPrice: 0,
      totalPrice: 0,
      membershipUser: {
        membershipId: 'pack',
        membership: { name: 'Pack', sessions: 50 },
        invoice: null,
      },
    }),
  ])
  expect(
    (await getCourtPerformance('2026-10-01', '2026-10-01')).summary,
  ).toMatchObject({ unvaluedMembershipHours: 1, membershipAllocation: 0 })
})
it('resolves effective sport tariff rules at playing time and retains booked closures in capacity', async () => {
  mocks.rules.mockResolvedValue([
    {
      branchId: 'cemara',
      sport: 'PADEL',
      effectiveFrom: '2026-10-01',
      happyStart: 7,
      happyEnd: 15,
      peakStart: 0,
      peakEnd: 7,
    },
  ])
  mocks.slots.mockResolvedValue([{ ...slot('s1', 6), scheduleClosed: true }])
  const report = await getCourtPerformance('2026-10-01', '2026-10-01')
  expect(report.rows[0].band).toBe('peakHour')
  expect(report.summary.occupancy).toBe(100)
})
it('returns zero occupancy with no published capacity or bookings', async () => {
  mocks.slots.mockResolvedValue([])
  mocks.bookings.mockResolvedValue([])
  const report = await getCourtPerformance('2026-10-01', '2026-10-01')
  expect(report.summary).toMatchObject({
    capacityHours: 0,
    occupancy: 0,
    hours: 0,
    revenue: 0,
    bookings: 0,
  })
})

it('counts HOLD reservations in operational capacity without counting their hours as confirmed', async () => {
  mocks.slots.mockResolvedValue([
    slot('s1', 6),
    { ...slot('hold', 7), bookingDetails: [{ id: 'hold-detail' }] },
  ])
  const report = await getCourtPerformance('2026-10-01', '2026-10-01')
  expect(report.summary).toMatchObject({
    capacityHours: 2,
    hours: 1,
    occupancy: 50,
  })
})
it('excludes unbooked capacity beyond a shortened rolling horizon but preserves confirmed reservations', async () => {
  mocks.courts.mockResolvedValue([{ ...court, bookingWindowMonths: 1 }])
  mocks.slots.mockResolvedValue([
    slot('s1', 6),
    {
      ...slot('old-generated', 7, true),
      startAt: new Date('2026-12-01T00:00:00Z'),
      endAt: new Date('2026-12-01T01:00:00Z'),
    },
  ])
  const report = await getCourtPerformance('2026-10-01', '2026-12-31')
  expect(report.summary.capacityHours).toBe(1)
})
it('compares branches using playing location and weighted capacity, including cross-branch Value Pack purchases', async () => {
  const secondCourt = {
    ...court,
    id: 'court-2',
    branchId: 's-parman',
    name: 'Court 1',
    branch: { name: 'S. Parman' },
  }
  const secondSlot = {
    ...slot('s2', 7),
    courtId: secondCourt.id,
    court: secondCourt,
  }
  mocks.courts.mockResolvedValue([
    { ...court, branch: { name: 'Cemara' } },
    secondCourt,
  ])
  mocks.slots.mockResolvedValue([
    slot('s1', 6),
    secondSlot,
    ...[8, 9].map((h) => ({
      ...slot(`s${h}`, h, true),
      courtId: secondCourt.id,
      court: secondCourt,
    })),
  ])
  mocks.bookings.mockResolvedValue([
    booking(),
    booking({
      id: 'b2',
      membershipUserId: 'mu',
      courtDiscountPrice: 0,
      totalPrice: 0,
      membershipUser: {
        membershipId: 'pack',
        membership: { name: '50-hour', sessions: 50 },
        invoice: {
          branchId: 'cemara',
          status: 'PAID',
          total: 5000000,
          processingFee: 0,
        },
      },
      details: [
        {
          id: 'd2',
          slotId: 's2',
          price: 200000,
          discountPrice: 0,
          slot: secondSlot,
        },
      ],
    }),
  ])
  const report = await getCourtPerformance('2026-10-01', '2026-10-01')
  expect(report.branchSummary.find((b) => b.id === 'cemara')).toMatchObject({
    paidRevenue: 200000,
    membershipAllocation: 0,
    occupancy: 100,
  })
  expect(report.branchSummary.find((b) => b.id === 's-parman')).toMatchObject({
    paidRevenue: 0,
    membershipAllocation: 100000,
    capacityHours: 3,
    occupiedHours: 1,
  })
  expect(report.summary.occupancy).toBe(50)
  expect(report.branchSummary.reduce((sum, b) => sum + b.revenue, 0)).toBe(
    report.summary.revenue,
  )
})
