import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import * as XLSX from 'xlsx'
const mocks = vi.hoisted(() => ({ invoices: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { invoice: { findMany: mocks.invoices } },
}))
import {
  allocateServicePayment,
  buildServiceIncome,
  getServiceIncome,
} from './service-income.service'
import {
  serviceIncomeHandler,
  serviceIncomeExportHandler,
} from '@/handlers/admin/service-income.handler'

const item = (id: string, price: number, group = 'club-a') => ({
  id,
  price,
  status: 'CONFIRMED',
  coachingGroupId: group,
  coachingGroupName: group === 'club-a' ? 'Club A' : 'Club B',
  slot: {
    staff: { id: `staff-${id}`, name: `Petugas ${id}` },
    startAt: new Date('2026-11-10T12:00:00Z'),
    endAt: new Date('2026-11-10T13:00:00Z'),
  },
})
const invoice = () => ({
  id: 'invoice',
  number: 'INV-001',
  status: 'PAID',
  paidAt: new Date('2026-11-05T17:30:00Z'),
  total: 405000,
  processingFee: 5000,
  branchId: 'cemara',
  branch: { name: 'Cemara' },
  user: { name: 'Andi' },
  booking: {
    id: 'booking',
    status: 'CONFIRMED',
    purpose: 'REGULAR',
    totalPrice: 400000,
    promoDiscountAmount: 0,
    coaches: [item('coach', 150000)],
    ballboys: [item('ballboy', 50000)],
  },
})
const build = (data: unknown[], filters = {}) =>
  buildServiceIncome(data as Parameters<typeof buildServiceIncome>[0], filters)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.invoices.mockResolvedValue([invoice()])
})

it('pays 100% of service income, excludes court and fees, and keeps ballboys unassigned', () => {
  const report = build([invoice()])
  expect(report.summary).toEqual({
    totalAmount: 200000,
    coachAmount: 150000,
    ballboyAmount: 50000,
    unassignedAmount: 50000,
    invoiceCount: 1,
    sessions: 2,
    clubCount: 1,
  })
  expect(report.clubs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'club-a',
        name: 'Club A',
        totalAmount: 150000,
      }),
      expect.objectContaining({
        id: 'unassigned',
        name: 'Tanpa Club',
        totalAmount: 50000,
      }),
    ]),
  )
  expect(report.rows.find((row) => row.service === 'COACH')).toMatchObject({
    staffName: 'Petugas coach',
    clubName: 'Club A',
    startAt: '2026-11-10 12:00:00',
    amount: 150000,
  })
  expect(report.rows.reduce((sum, row) => sum + row.amount, 0)).toBe(
    report.summary.totalAmount,
  )
  expect(report.staff.reduce((sum, row) => sum + row.amount, 0)).toBe(
    report.summary.totalAmount,
  )
})

it('allocates order promos to services without paying out the court share or fees', () => {
  const data = invoice()
  data.total = 365000
  data.booking.totalPrice = 360000
  data.booking.promoDiscountAmount = 40000
  const report = build([data])
  expect(report.summary).toMatchObject({
    totalAmount: 180000,
    coachAmount: 135000,
    ballboyAmount: 45000,
  })
  expect(report.rows.reduce((sum, row) => sum + row.discount, 0)).toBe(20000)
})

it('does not reallocate cancelled service income to the remaining club', () => {
  const data = invoice()
  data.booking.coaches[0].status = 'CANCELLED'
  data.total = 365000
  data.booking.totalPrice = 360000
  data.booking.promoDiscountAmount = 40000
  expect(build([data]).summary).toMatchObject({
    totalAmount: 45000,
    coachAmount: 0,
    ballboyAmount: 45000,
  })
})

it.each(['PENDING', 'REFUNDED', 'CANCELLED', 'EXPIRED'])(
  'excludes %s invoices',
  (status) => {
    expect(build([{ ...invoice(), status }]).summary.totalAmount).toBe(0)
  },
)
it('excludes cancelled bookings, internal bookings, missing paid date and free services', () => {
  const original = invoice()
  const free = invoice()
  free.booking.coaches[0].price = 0
  free.booking.ballboys[0].price = 0
  expect(
    build([
      { ...original, booking: { ...original.booking, status: 'CANCELLED' } },
      {
        ...original,
        booking: { ...original.booking, purpose: 'COACH_TRAINING' },
      },
      { ...original, paidAt: null },
      free,
    ]).rows,
  ).toEqual([])
})

it('preserves the recorded club even after its record is removed', () => {
  const data = invoice()
  data.booking.coaches[0].coachingGroupId = null as unknown as string
  expect(build([data]).clubs).toContainEqual(
    expect.objectContaining({
      id: 'archived:Club A',
      name: 'Club A',
      coachAmount: 150000,
    }),
  )
})

it('keeps summaries, staff and details consistent with club, person and service filters', () => {
  const data = invoice()
  data.booking.coaches.push(item('coach-b', 100000, 'club-b'))
  const report = build([data], {
    clubId: 'club-b',
    staffId: 'staff-coach-b',
    service: 'COACH',
  })
  expect(report.summary).toMatchObject({
    totalAmount: 100000,
    sessions: 1,
    invoiceCount: 1,
    clubCount: 1,
  })
  expect(report.rows).toHaveLength(1)
  expect(report.options.clubs).toHaveLength(3)
  expect(build([data], { clubId: 'unassigned' }).summary.totalAmount).toBe(
    50000,
  )
})

it('rounds in whole rupiah without creating or overpaying service income', () => {
  expect(allocateServicePayment([1, 1, 1], 3, 2)).toEqual([1, 1, 0])
  expect(allocateServicePayment([100, 100], 200, 500)).toEqual([100, 100])
  expect(allocateServicePayment([0], 0, 0)).toEqual([0])
  for (let paid = 0; paid < 40; paid++) {
    const result = allocateServicePayment([7, 11, 13], 40, paid)
    expect(result.every(Number.isInteger)).toBe(true)
    expect(result.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(
      paid,
    )
  }
})

it('queries the same branch-scoped paid invoice set by payment date, not session date', async () => {
  const from = new Date('2026-11-05T17:00:00Z'),
    to = new Date('2026-11-06T16:59:59.999Z')
  await getServiceIncome(from, to)
  expect(mocks.invoices.mock.calls[0][0].where).toEqual({
    status: 'PAID',
    paidAt: { gte: from, lte: to },
    booking: {
      is: {
        status: 'CONFIRMED',
        purpose: 'REGULAR',
        OR: [{ coaches: { some: {} } }, { ballboys: { some: {} } }],
      },
    },
  })
})

const request = (query: string, role?: string, exportFile = false) => {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    if (role) c.set('admin', { role })
    await next()
  })
  if (exportFile) app.get('/report', ...serviceIncomeExportHandler)
  else app.get('/report', ...serviceIncomeHandler)
  return app.request(`/report?${query}`)
}
const valid = 'startDate=2026-11-05T17:00:00Z&endDate=2026-11-06T16:59:59.999Z'
it.each(['ADMIN', 'SUPER_ADMIN', 'ADMIN_VIEWER'])(
  'allows %s to read financial report',
  async (role) => {
    expect((await request(valid, role)).status).toBe(200)
  },
)
it('rejects unauthenticated access and unrelated staff roles', async () => {
  expect((await request(valid)).status).toBe(401)
  expect((await request(valid, 'COACH')).status).toBe(403)
  expect(mocks.invoices).not.toHaveBeenCalled()
})
it('rejects reversed, invalid and unbounded date ranges', async () => {
  for (const query of [
    '',
    'startDate=no&endDate=no',
    'startDate=2026-11-06T00:00:00Z&endDate=2026-11-05T00:00:00Z',
    'startDate=2020-01-01T00:00:00Z&endDate=2026-11-05T00:00:00Z',
  ])
    expect((await request(query, 'ADMIN')).status).toBe(422)
  expect(mocks.invoices).not.toHaveBeenCalled()
})
it('exports an Excel workbook that matches the selected club and service filters', async () => {
  const response = await request(
    `${valid}&clubId=unassigned&service=BALLBOY`,
    'ADMIN',
    true,
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toContain('spreadsheetml')
  const book = XLSX.read(Buffer.from(await response.arrayBuffer()))
  const rows = XLSX.utils.sheet_to_json(
    book.Sheets['Detail transaksi'],
  ) as Record<string, unknown>[]
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    Jenis: 'BALLBOY',
    Club: 'Tanpa Club',
    'Hak club (100%)': 50000,
  })
})

it.each(['COACH', 'BALLBOY', 'BOTH'])(
  'excludes cancelled %s from every report total while preserving active services',
  (kind) => {
    const data = invoice()
    if (kind !== 'BALLBOY') data.booking.coaches[0].status = 'CANCELLED'
    if (kind !== 'COACH') data.booking.ballboys[0].status = 'CANCELLED'
    const report = build([data])
    const expected = kind === 'COACH' ? 50000 : kind === 'BALLBOY' ? 150000 : 0
    expect(report.summary.totalAmount).toBe(expected)
    expect(report.rows.reduce((total, row) => total + row.amount, 0)).toBe(
      expected,
    )
    expect(report.staff.reduce((total, row) => total + row.amount, 0)).toBe(
      expected,
    )
    expect(
      report.clubs.reduce((total, row) => total + row.totalAmount, 0),
    ).toBe(expected)
    expect(report.summary.sessions).toBe(kind === 'BOTH' ? 0 : 1)
  },
)
it.each(['COACH', 'BALLBOY'])(
  'excludes a cancelled %s on a separate paid service invoice',
  (kind) => {
    const data = invoice()
    data.booking.totalPrice = kind === 'COACH' ? 150000 : 50000
    data.processingFee = 0
    data.total = data.booking.totalPrice
    if (kind === 'COACH') {
      data.booking.ballboys = []
      data.booking.coaches[0].status = 'CANCELLED'
    } else {
      data.booking.coaches = []
      data.booking.ballboys[0].status = 'CANCELLED'
    }
    const report = build([data])
    expect(data.status).toBe('PAID')
    expect(data.booking.status).toBe('CONFIRMED')
    expect(report.summary).toMatchObject({
      totalAmount: 0,
      coachAmount: 0,
      ballboyAmount: 0,
      invoiceCount: 0,
      sessions: 0,
    })
    expect(report.rows).toEqual([])
    expect(report.staff).toEqual([])
    expect(report.clubs).toEqual([])
  },
)
it('omits cancelled services from the exported details and summary even when invoices remain paid', async () => {
  const data = invoice()
  data.booking.coaches[0].status = 'CANCELLED'
  data.booking.ballboys[0].status = 'CANCELLED'
  mocks.invoices.mockResolvedValue([data])
  const response = await request(valid, 'ADMIN', true)
  expect(response.status).toBe(200)
  const book = XLSX.read(Buffer.from(await response.arrayBuffer()))
  expect(XLSX.utils.sheet_to_json(book.Sheets['Detail transaksi'])).toEqual([])
  expect(XLSX.utils.sheet_to_json(book.Sheets['Per petugas'])).toEqual([])
  expect(XLSX.utils.sheet_to_json(book.Sheets['Ringkasan'])).toEqual([
    expect.objectContaining({
      'Hak coach': 0,
      'Hak ballboy': 0,
      'Total hak club': 0,
    }),
  ])
})
