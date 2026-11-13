import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoices: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { invoice: { findMany: mocks.invoices } },
}))
vi.mock('@/services/upload.service', () => ({ getFileUrl: vi.fn() }))
import { getIncomeBySourceAnalytics } from './analytics.service'
import { appendRescheduleAudit } from '@/lib/booking-reschedule-audit'

const start = new Date('2026-09-30T17:00:00.000Z')
const end = new Date('2026-10-01T16:59:59.999Z')
const invoice = (id: string, total: number, processingFee = 0) => ({
  id,
  number: `INV-${id}`,
  branchId: 'cemara',
  branch: { name: 'Cemara' },
  user: { id: `user-${id}`, name: `Customer ${id}` },
  payment: { method: { name: 'QRIS' } },
  paidAt: new Date('2026-09-30T17:30:00Z'),
  total,
  processingFee,
  booking: null,
  classBooking: null,
  membershipUser: null,
})
beforeEach(() => vi.resetAllMocks())

it('returns one identifiable customer row per paid invoice and reconciles all amounts to the summary', async () => {
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('online', 102000, 2000),
      booking: { id: 'b1', cashierId: null },
    },
    // Cashier identity comes from the booking FK even if the staff relation is unavailable.
    {
      ...invoice('cashier', 250000),
      booking: { id: 'b2', cashierId: 'staff-1', cashier: null },
    },
    { ...invoice('pack', 300000), membershipUser: { id: 'pack-1' } },
    invoice('removed-product', 50000),
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions).toHaveLength(data.summary.totalTransactions)
  expect(data.transactions.reduce((sum, row) => sum + row.amount, 0)).toBe(
    data.summary.totalGrossAmount,
  )
  expect(
    data.transactions.reduce((sum, row) => sum + row.processingFee, 0),
  ).toBe(data.summary.totalProcessingFees)
  expect(data.transactions.reduce((sum, row) => sum + row.netAmount, 0)).toBe(
    data.summary.totalNetAmount,
  )
  expect(data.transactions[0]).toMatchObject({
    id: 'online',
    invoiceNumber: 'INV-online',
    customerName: 'Customer online',
    branchName: 'Cemara',
    source: 'Online',
    paymentMethod: 'QRIS',
    paidAt: new Date('2026-09-30T17:30:00Z'),
    netAmount: 100000,
  })
  expect(data.transactions.map((row) => row.source)).toEqual([
    'Online',
    'Cashier',
    'Membership',
    'Other',
  ])
  expect(data.bySource.Cashier.total).toBe(250000)
  expect(mocks.invoices).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        status: { in: ['PAID', 'CANCELLED'] },
        paidAt: { gte: start, lte: end },
      },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      include: expect.objectContaining({
        user: { select: { id: true, name: true } },
      }),
    }),
  )
})

it('handles class invoices and missing payment methods', async () => {
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('class', 100000),
      classBooking: { id: 'class-1' },
      payment: null,
    },
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions[0]).toMatchObject({
    source: 'Class Bookings',
    paymentMethod: null,
  })
})

it.each(['cashier', 'online'] as const)(
  'retains the %s source filter for both summary and transaction rows',
  async (source) => {
    mocks.invoices.mockResolvedValue([])
    await getIncomeBySourceAnalytics(start, end, source)
    expect(mocks.invoices.mock.calls[0][0].where.booking).toEqual({
      isNot: null,
      cashierId: source === 'cashier' ? { not: null } : null,
    })
  },
)

it('returns an empty transaction list and zero totals when no paid invoices match', async () => {
  mocks.invoices.mockResolvedValue([])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions).toEqual([])
  expect(data.summary).toMatchObject({
    totalTransactions: 0,
    totalGrossAmount: 0,
    totalNetAmount: 0,
    totalProcessingFees: 0,
  })
})

it('identifies service invoices by their parent court booking without changing invoice totals', async () => {
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('court', 300000),
      booking: { id: 'court-1', cashierId: 'staff-1' },
    },
    {
      ...invoice('coach', 50000),
      booking: {
        id: 'service-1',
        serviceForBookingId: 'court-1',
        cashierId: 'staff-1',
      },
    },
    {
      ...invoice('ballboy', 0),
      booking: {
        id: 'service-2',
        serviceForBookingId: 'court-1',
        cashierId: 'staff-1',
      },
    },
    invoice('other', 10000),
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions.map((row) => row.bookingId)).toEqual([
    'court-1',
    'court-1',
    'court-1',
    null,
  ])
  expect(data.transactions).toHaveLength(4)
  expect(data.summary.totalGrossAmount).toBe(360000)
})

it('returns playing times in WIB, merges consecutive court hours and preserves gaps and services', async () => {
  const slot = (startAt: string, endAt: string) => ({
    startAt: new Date(startAt),
    endAt: new Date(endAt),
  })
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('court', 300000),
      booking: {
        id: 'court-1',
        cashierId: 'staff-1',
        details: [
          {
            slot: {
              ...slot('2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z'),
              court: { name: 'Court A' },
            },
          },
          {
            slot: {
              ...slot('2026-11-03T10:00:00Z', '2026-11-03T11:00:00Z'),
              court: { name: 'Court A' },
            },
          },
          {
            slot: {
              ...slot('2026-11-03T13:00:00Z', '2026-11-03T14:00:00Z'),
              court: { name: 'Court A' },
            },
          },
        ],
        coaches: [
          { slot: slot('2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z') },
        ],
        ballboys: [
          { slot: slot('2026-11-03T23:00:00Z', '2026-11-04T00:00:00Z') },
        ],
      },
    },
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions[0].playingSchedules).toEqual(
    expect.arrayContaining([
      {
        label: 'Lapangan · Court A',
        startAt: '2026-11-03T09:00:00+07:00',
        endAt: '2026-11-03T11:00:00+07:00',
      },
      {
        label: 'Lapangan · Court A',
        startAt: '2026-11-03T13:00:00+07:00',
        endAt: '2026-11-03T14:00:00+07:00',
      },
      {
        label: 'Coach',
        startAt: '2026-11-03T09:00:00+07:00',
        endAt: '2026-11-03T10:00:00+07:00',
      },
      {
        label: 'Ballboy',
        startAt: '2026-11-03T23:00:00+07:00',
        endAt: '2026-11-04T00:00:00+07:00',
      },
    ]),
  )
  expect(data.transactions[0].playingSchedules).toHaveLength(4)
})

it('records in-house package sales once in their own revenue source', async () => {
  mocks.invoices.mockResolvedValue([
    { ...invoice('inhouse', 4500000), inHouseWallet: { id: 'wallet' } },
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.summary).toMatchObject({
    totalIncome: 4500000,
    totalNetAmount: 4500000,
    inHouseIncome: 4500000,
    totalTransactions: 1,
  })
  expect(data.bySource.InHouse).toMatchObject({ count: 1, total: 4500000 })
  expect(data.transactions[0].source).toBe('InHouse')
})

it('marks a cancelled paid ballboy-only invoice even when its booking remains confirmed', async () => {
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('cancelled-ballboy', 45000),
      booking: {
        id: 'service',
        status: 'CONFIRMED',
        cashierId: 'cashier',
        details: [],
        coaches: [],
        ballboys: [
          {
            status: 'CANCELLED',
            price: 45000,
            cancelledAt: new Date('2026-10-01T01:00:00Z'),
            cancellationReason: 'Customer membatalkan',
            slot: {
              startAt: new Date('2026-10-02T19:00:00Z'),
              endAt: new Date('2026-10-02T20:00:00Z'),
              staff: { name: 'Topan' },
            },
          },
        ],
      },
    },
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions[0]).toMatchObject({
    paymentStatus: 'PAID',
    bookingStatus: 'CONFIRMED',
    cancellationStatus: 'CANCELLED',
    amount: 45000,
    cancelledServices: [
      {
        kind: 'BALLBOY',
        name: 'Topan',
        amount: 45000,
        reason: 'Customer membatalkan',
      },
    ],
  })
  expect(data.summary.totalNetAmount).toBe(0)
  expect(data.summary.totalExcludedAmount).toBe(45000)
  expect(
    mocks.invoices.mock.calls[0][0].include.booking.include.ballboys.select,
  ).toMatchObject({ status: true, cancelledAt: true, cancellationReason: true })
})
it('marks partial cancellations when the court or another service remains active', async () => {
  const slot = {
    startAt: new Date('2026-10-02T19:00:00Z'),
    endAt: new Date('2026-10-02T20:00:00Z'),
  }
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('partial', 345000),
      booking: {
        id: 'court',
        status: 'CONFIRMED',
        details: [{ slot: { ...slot, court: { name: 'Court 1' } } }],
        coaches: [],
        ballboys: [{ status: 'CANCELLED', price: 45000, slot }],
      },
    },
    {
      ...invoice('mixed-services', 90000),
      booking: {
        id: 'services',
        status: 'CONFIRMED',
        details: [],
        ballboys: [
          { status: 'CANCELLED', price: 45000, slot },
          { status: 'CONFIRMED', price: 45000, slot },
        ],
      },
    },
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions.map((row) => row.cancellationStatus)).toEqual([
    'PARTIAL',
    'PARTIAL',
  ])
  expect(data.summary.totalGrossAmount).toBe(435000)
})
it('marks cancelled whole bookings and classes without assuming a refund', async () => {
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('court', 300000),
      booking: { id: 'court', status: 'CANCELLED' },
    },
    {
      ...invoice('class', 100000),
      classBooking: { id: 'class', status: 'CANCELLED' },
    },
    {
      ...invoice('active', 50000),
      booking: { id: 'active', status: 'CONFIRMED' },
    },
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions.map((row) => row.cancellationStatus)).toEqual([
    'CANCELLED',
    'CANCELLED',
    'NONE',
  ])
  expect(data.summary.totalGrossAmount).toBe(450000)
})

it('retains paid cancellation history but excludes its entire revenue including child invoices', async () => {
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('court-cancelled', 300000, 2000),
      status: 'CANCELLED',
      booking: { id: 'root', status: 'CANCELLED', cashierId: 'cashier' },
    },
    {
      ...invoice('child', 45000),
      status: 'PAID',
      booking: {
        id: 'child',
        cashierId: 'cashier',
        status: 'CONFIRMED',
        serviceForBooking: { status: 'CANCELLED' },
      },
    },
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.summary).toMatchObject({
    totalGrossAmount: 345000,
    totalProcessingFees: 2000,
    totalExcludedAmount: 343000,
    totalNetAmount: 0,
  })
  expect(data.bySource.Cashier.total).toBe(0)
  expect(data.transactions.map((row) => row.netAmount)).toEqual([0, 0])
})
it('excludes only the cancelled service share after an invoice discount', async () => {
  const slot = {
    startAt: new Date('2040-01-05T09:00:00Z'),
    endAt: new Date('2040-01-05T10:00:00Z'),
  }
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('partial-discount', 270000),
      booking: {
        id: 'root',
        cashierId: 'cashier',
        status: 'CONFIRMED',
        totalPrice: 270000,
        promoDiscountAmount: 30000,
        details: [{ slot }],
        ballboys: [{ status: 'CANCELLED', price: 60000, slot }],
      },
    },
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions[0]).toMatchObject({
    amount: 270000,
    excludedAmount: 54000,
    netAmount: 216000,
    cancellationStatus: 'PARTIAL',
  })
  expect(data.bySource.Cashier.total).toBe(216000)
})

it('reports rescheduling only on the invoices whose court or service actually moved', async () => {
  const event = {
    at: '2026-11-11T03:00:00.000Z',
    actorId: 'admin',
    bookingId: 'parent',
    from: {
      court: 'Court 1',
      startAt: '2026-11-12T19:00:00+07:00',
      endAt: '2026-11-12T20:00:00+07:00',
    },
    to: {
      court: 'Court 2',
      startAt: '2026-11-13T19:00:00+07:00',
      endAt: '2026-11-13T20:00:00+07:00',
    },
  }
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('court', 250000),
      booking: {
        id: 'parent',
        cashierId: 'cashier',
        adminNote: appendRescheduleAudit(null, event),
      },
    },
    {
      ...invoice('moved-service', 45000),
      booking: {
        id: 'service',
        serviceForBookingId: 'parent',
        adminNote: appendRescheduleAudit(null, event),
      },
    },
    {
      ...invoice('unmoved-service', 45000),
      booking: {
        id: 'another',
        serviceForBookingId: 'parent',
        serviceForBooking: {
          status: 'CONFIRMED',
          adminNote: appendRescheduleAudit(null, event),
        },
      },
    },
  ])
  const data = await getIncomeBySourceAnalytics(start, end)
  expect(data.transactions[0].reschedule).toEqual(event)
  expect(data.transactions[1].reschedule).toEqual(event)
  expect(data.transactions[2].reschedule).toBeNull()
  expect(data.summary.totalNetAmount).toBe(340000)
})

it.each(['PAID', 'CANCELLED'])(
  'keeps a cancelled in-house sale visible with zero revenue even if its old invoice is %s',
  async (status) => {
    mocks.invoices.mockResolvedValue([
      {
        ...invoice('package', 4500000),
        status,
        inHouseWallet: {
          id: 'wallet',
          deletedAt: new Date('2026-11-13T08:00:00Z'),
        },
      },
    ])
    const data = await getIncomeBySourceAnalytics(start, end)
    expect(data.summary).toMatchObject({
      inHouseIncome: 0,
      totalIncome: 0,
      totalNetAmount: 0,
      totalExcludedAmount: 4500000,
    })
    expect(data.bySource.InHouse.total).toBe(0)
    expect(data.transactions[0]).toMatchObject({
      cancellationStatus: 'CANCELLED',
      amount: 4500000,
      netAmount: 0,
      excludedAmount: 4500000,
    })
  },
)
