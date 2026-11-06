import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ payments: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { payment: { findMany: mocks.payments } },
}))
vi.mock('@/services/upload.service', () => ({
  getFileUrl: async (value: string) => value,
}))
import { getPaymentMethodAnalytics } from './analytics.service'

const start = new Date('2026-11-05T17:00:00Z'),
  end = new Date('2026-11-06T16:59:59.999Z')
const payment = (
  id: string,
  methodId: string,
  total: number,
  processingFee = 0,
) => ({
  id: `payment-${id}`,
  method: { id: methodId, name: methodId, logo: null },
  createdAt: new Date('2026-10-01T00:00:00Z'),
  paidAt: new Date('2026-11-06T01:00:00Z'),
  invoice: {
    id: `invoice-${id}`,
    number: `INV-${id}`,
    total,
    processingFee,
    paidAt: new Date('2026-11-06T01:00:00Z'),
    branchId: 'cemara',
    branch: { name: 'Cemara' },
    user: { name: `Customer ${id}` },
    booking: { cashierId: null },
    classBookingId: null,
    membershipUserId: null,
  },
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.payments.mockResolvedValue([])
})

it('reconciles each method card to its identifiable invoice rows and the overall summary', async () => {
  mocks.payments.mockResolvedValue([
    payment('a', 'QRIS', 102000, 2000),
    payment('b', 'CASH', 50000),
    payment('c', 'QRIS', 204000, 4000),
  ])
  const report = await getPaymentMethodAnalytics(start, end)
  expect(report.summary).toEqual({
    totalAmount: 356000,
    totalProcessingFees: 6000,
    totalTransactions: 3,
    methodCount: 2,
  })
  expect(report.methods.map((method) => method.method.id)).toEqual([
    'QRIS',
    'CASH',
  ])
  for (const method of report.methods) {
    expect(method.count).toBe(method.transactions.length)
    expect(
      method.transactions.reduce(
        (sum: number, row: any) => sum + row.amount,
        0,
      ),
    ).toBe(method.total)
    expect(
      method.transactions.reduce(
        (sum: number, row: any) => sum + row.processingFee,
        0,
      ),
    ).toBe(method.processingFee)
    expect(
      method.transactions.reduce(
        (sum: number, row: any) => sum + row.netAmount,
        0,
      ),
    ).toBe(method.total - method.processingFee)
  }
  expect(report.methods[0].transactions[0]).toMatchObject({
    id: 'invoice-a',
    invoiceNumber: 'INV-a',
    customerName: 'Customer a',
    branchName: 'Cemara',
    paymentMethod: 'QRIS',
    source: 'Online',
    paidAt: new Date('2026-11-06T01:00:00Z'),
    netAmount: 100000,
  })
})

it.each([undefined, 'cashier', 'online'] as const)(
  'uses paid invoice dates, excludes refunds and preserves %s source filtering',
  async (source) => {
    await getPaymentMethodAnalytics(start, end, source)
    const where = mocks.payments.mock.calls[0][0].where
    expect(where.status).toBe('PAID')
    expect(where).not.toHaveProperty('createdAt')
    expect(where.invoice.is).toMatchObject({
      status: 'PAID',
      paidAt: { gte: start, lte: end },
    })
    if (source)
      expect(where.invoice.is.booking).toEqual({
        cashierId: source === 'cashier' ? { not: null } : null,
      })
    else expect(where.invoice.is).not.toHaveProperty('booking')
  },
)

it('includes class and membership invoices and handles missing customer metadata', async () => {
  const member = payment('member', 'TRANSFER', 300000)
  const lesson = payment('class', 'TRANSFER', 100000)
  mocks.payments.mockResolvedValue([
    {
      ...member,
      invoice: { ...member.invoice, booking: null, membershipUserId: 'pack' },
    },
    {
      ...lesson,
      invoice: {
        ...lesson.invoice,
        booking: null,
        classBookingId: 'lesson',
        user: null,
        branch: null,
      },
    },
  ])
  const report = await getPaymentMethodAnalytics(start, end)
  expect(report.methods[0].transactions.map((row: any) => row.source)).toEqual([
    'Membership',
    'Class Bookings',
  ])
  expect(report.methods[0].transactions[1]).toMatchObject({
    customerName: 'Customer tidak tersedia',
    branchName: 'cemara',
  })
})

it('does not create a phantom invoice row or count an orphan payment', async () => {
  mocks.payments.mockResolvedValue([
    { ...payment('orphan', 'CASH', 100000), invoice: null },
  ])
  expect((await getPaymentMethodAnalytics(start, end)).summary).toEqual({
    totalAmount: 0,
    totalProcessingFees: 0,
    totalTransactions: 0,
    methodCount: 0,
  })
})
