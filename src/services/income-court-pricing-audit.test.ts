import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import * as XLSX from 'xlsx'
const mocks = vi.hoisted(() => ({ invoices: vi.fn(), tariffs: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    invoice: { findMany: mocks.invoices },
    tariffPeriod: { findMany: mocks.tariffs },
  },
}))
vi.mock('@/services/upload.service', () => ({ getFileUrl: vi.fn() }))
import { getIncomeBySourceAnalytics } from './analytics.service'
import { buildServiceIncome } from './service-income.service'
import { createIncomeSourceWorkbook } from './income-source-export'
import { serviceIncomeExportHandler } from '@/handlers/admin/service-income.handler'
const start = new Date('2026-11-11T17:00:00Z')
const end = new Date('2026-11-12T16:59:59.999Z')
const range = {
  startAt: new Date('2026-11-12T12:00:00Z'),
  endAt: new Date('2026-11-12T13:00:00Z'),
}
const service = (id: string, price: number) => ({
  id,
  price,
  status: 'CONFIRMED',
  coachingGroupId: 'club-a',
  coachingGroupName: 'Club A',
  slot: { ...range, staff: { id, name: id } },
})
const invoice = (courtPrice: number, coachPrice: number, promo = 0) => ({
  id: 'invoice-1',
  number: 'INV-001',
  status: 'PAID',
  paidAt: start,
  branchId: 'cemara',
  branch: { name: 'Cemara' },
  user: { id: 'customer', name: 'Budi' },
  payment: { method: { name: 'Tunai' } },
  processingFee: 5000,
  total: courtPrice + coachPrice + 50000 - promo + 5000,
  booking: {
    id: 'booking-1',
    cashierId: 'cashier',
    purpose: 'REGULAR',
    status: 'CONFIRMED',
    totalPrice: courtPrice + coachPrice + 50000 - promo,
    promoDiscountAmount: promo,
    courtDiscountPrice: courtPrice,
    details: [
      {
        price: 350000,
        discountPrice: courtPrice,
        slot: { ...range, court: { name: 'Court 2' } },
      },
    ],
    coaches: [service('coach', coachPrice)],
    ballboys: [service('ballboy', 50000)],
  },
})
const serviceReport = (data: unknown) =>
  buildServiceIncome([data] as Parameters<typeof buildServiceIncome>[0])
beforeEach(() => {
  vi.clearAllMocks()
  mocks.tariffs.mockRejectedValue(
    new Error('Historical reports must not recalculate today’s tariffs'),
  )
})
it.each([
  ['happy hour', 105000, 0],
  ['peak hour', 325000, 0],
  ['happy hour plus promo', 105000, 35500],
  ['fully discounted court', 0, 0],
] as const)(
  'keeps the recorded %s court price out of club payouts in both income reports',
  async (_, courtPrice, promo) => {
    const data = invoice(courtPrice, 200000, promo)
    mocks.invoices.mockResolvedValue([data])
    const sources = await getIncomeBySourceAnalytics(start, end)
    const services = serviceReport(data)
    const factor = promo ? 0.9 : 1
    expect(sources.summary.totalNetAmount).toBe(data.total - data.processingFee)
    expect(services.summary.coachAmount).toBe(200000 * factor)
    expect(services.summary.ballboyAmount).toBe(50000 * factor)
    expect(sources.summary.totalNetAmount - services.summary.totalAmount).toBe(
      courtPrice * factor,
    )
    expect(sources.summary.revenueBreakdown).toEqual({
      court: courtPrice * factor,
      coach: 200000 * factor,
      ballboy: 50000 * factor,
      other: 0,
    })
    expect(sources.transactions[0].revenueBreakdown).toEqual(
      sources.summary.revenueBreakdown,
    )
    expect(mocks.tariffs).not.toHaveBeenCalled()
  },
)
it.each([1, 2, 3])(
  'keeps two fixed in-house court hours, full coach fees and %s participants reconciled without adding them to club payables',
  async (participants) => {
    const data = invoice(500000, 1500000 + (participants - 1) * 200000)
    data.booking.coaches[0] = {
      ...data.booking.coaches[0],
      bookingCoachType: { name: 'Coaching In-house' },
      inHouseUsage: null,
    } as (typeof data.booking.coaches)[0]
    data.booking.details = [0, 1].map((index) => ({
      price: 150000,
      discountPrice: 250000,
      slot: {
        ...range,
        court: { name: 'Court 2' },
        startAt: new Date(+range.startAt + index * 3600000),
        endAt: new Date(+range.endAt + index * 3600000),
      },
    }))
    mocks.invoices.mockResolvedValue([data])
    const sources = await getIncomeBySourceAnalytics(start, end)
    const services = serviceReport(data)
    expect(sources.summary.totalNetAmount).toBe(
      2050000 + (participants - 1) * 200000,
    )
    expect(services.summary).toMatchObject({
      coachAmount: 0,
      ballboyAmount: 50000,
      totalAmount: 50000,
    })
    expect(
      sources.summary.totalNetAmount -
        data.booking.coaches[0].price -
        services.summary.totalAmount,
    ).toBe(500000)
    expect(mocks.tariffs).not.toHaveBeenCalled()
  },
)
it('keeps the historical court discount after a coach cancellation and applies promo shares consistently', async () => {
  const data = invoice(105000, 200000, 35500)
  data.booking.coaches[0].status = 'CANCELLED'
  mocks.invoices.mockResolvedValue([data])
  const sources = await getIncomeBySourceAnalytics(start, end)
  const services = serviceReport(data)
  expect(sources.summary.totalExcludedAmount).toBe(180000)
  expect(sources.summary.totalNetAmount).toBe(139500)
  expect(services.summary.totalAmount).toBe(45000)
  expect(sources.summary.totalNetAmount - services.summary.totalAmount).toBe(
    94500,
  )
})
it('exports the same discounted-court allocation in Income by Source and Income Layanan Excel', async () => {
  const data = invoice(105000, 200000, 35500)
  mocks.invoices.mockResolvedValue([data])
  const sources = await getIncomeBySourceAnalytics(start, end)
  const sourceBook = createIncomeSourceWorkbook(sources)
  const sourceDetails = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    sourceBook.Sheets['Detail transaksi'],
  )
  expect(sourceDetails[0].Revenue).toBe(319500)
  expect(sourceDetails[0]['Revenue lapangan']).toBe(94500)
  expect(sourceDetails[0]['Revenue coach']).toBe(180000)
  expect(sourceDetails[0]['Revenue ballboy']).toBe(45000)
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    c.set('admin', { id: 'admin', role: 'ADMIN' })
    await next()
  })
  app.get('/services/export', ...serviceIncomeExportHandler)
  const query = new URLSearchParams({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  })
  const response = await app.request(`/services/export?${query}`)
  expect(response.status).toBe(200)
  const serviceBook = XLSX.read(await response.arrayBuffer(), { type: 'array' })
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    serviceBook.Sheets['Detail transaksi'],
  )
  expect(rows.find((row) => row.Jenis === 'COACH')?.['Hak club (100%)']).toBe(
    180000,
  )
  expect(rows.find((row) => row.Jenis === 'BALLBOY')?.['Hak club (100%)']).toBe(
    45000,
  )
})

it.each([1, 2, 3])(
  'reconciles full hourly coach income with %i club members and recorded coaching court rates',
  async (participants) => {
    const hourlyCoach = 150000 + (participants - 1) * 50000
    const data = invoice(210000, hourlyCoach * 2)
    data.booking.coaches = [0, 1].map((index) => ({
      ...service(`coach-${index}`, hourlyCoach),
      description: `Jumlah member: ${participants}`,
      slot: {
        ...range,
        staff: { id: 'coach', name: 'Coach Fredy' },
        startAt: new Date(+range.startAt + index * 3600000),
        endAt: new Date(+range.endAt + index * 3600000),
      },
    }))
    data.booking.details = [0, 1].map((index) => ({
      price: 150000,
      discountPrice: 105000,
      slot: {
        ...range,
        court: { name: 'Court 2' },
        startAt: new Date(+range.startAt + index * 3600000),
        endAt: new Date(+range.endAt + index * 3600000),
      },
    }))
    mocks.invoices.mockResolvedValue([data])
    const sources = await getIncomeBySourceAnalytics(start, end)
    const services = serviceReport(data)
    expect(sources.summary.revenueBreakdown).toEqual({
      court: 210000,
      coach: hourlyCoach * 2,
      ballboy: 50000,
      other: 0,
    })
    expect(services.summary.coachAmount).toBe(hourlyCoach * 2)
    expect(
      services.clubs.find((club) => club.id === 'club-a')?.coachAmount,
    ).toBe(hourlyCoach * 2)
    expect(
      services.staff.find((staff) => staff.service === 'COACH')?.amount,
    ).toBe(hourlyCoach * 2)
    expect(
      services.rows
        .filter((row) => row.service === 'COACH')
        .map((row) => row.description),
    ).toEqual([
      `Jumlah member: ${participants}`,
      `Jumlah member: ${participants}`,
    ])
    expect(
      Object.values(sources.summary.revenueBreakdown).reduce(
        (a, b) => a + b,
        0,
      ),
    ).toBe(sources.summary.totalNetAmount)
    expect(mocks.tariffs).not.toHaveBeenCalled()
  },
)

it('keeps cancellation and whole-rupiah promo allocations reconciled with service income', async () => {
  const data = invoice(105000, 200000, 1)
  data.booking.coaches[0].status = 'CANCELLED'
  mocks.invoices.mockResolvedValue([data])
  const sources = await getIncomeBySourceAnalytics(start, end)
  const services = serviceReport(data)
  expect(sources.summary.revenueBreakdown.coach).toBe(0)
  expect(sources.summary.revenueBreakdown.ballboy).toBe(
    services.summary.ballboyAmount,
  )
  expect(
    Object.values(sources.summary.revenueBreakdown).reduce((a, b) => a + b, 0),
  ).toBe(sources.summary.totalNetAmount)
  expect(mocks.tariffs).not.toHaveBeenCalled()
})

it('reconciles a separately paid reschedule increase without duplicating original court or service income', async () => {
  const original: any = invoice(105000, 150000)
  const extra: any = {
    ...invoice(0, 0),
    id: 'extra-invoice',
    number: 'INV-EXTRA',
    total: 295000,
    processingFee: 0,
    payment: {
      method: { name: 'Tunai' },
      meta: {
        source: 'ADMIN_COURT_RESCHEDULE',
        detailId: 'detail',
        courtBookingId: 'booking-1',
        courtAmount: 220000,
        services: [
          {
            serviceId: 'coach',
            kind: 'COACH',
            isInHouse: false,
            amount: 50000,
            staffId: 'coach',
            staffName: 'Coach',
            clubId: 'club-a',
            clubName: 'Club A',
            startAt: range.startAt.toISOString(),
            endAt: range.endAt.toISOString(),
          },
          {
            serviceId: 'ballboy',
            kind: 'BALLBOY',
            isInHouse: false,
            amount: 25000,
            staffId: 'ballboy',
            staffName: 'Ballboy',
            clubId: null,
            clubName: null,
            startAt: range.startAt.toISOString(),
            endAt: range.endAt.toISOString(),
          },
        ],
      },
    },
    booking: {
      id: 'extra-booking',
      cashierId: 'cashier',
      purpose: 'REGULAR',
      status: 'CONFIRMED',
      totalPrice: 295000,
      promoDiscountAmount: 0,
      details: [],
      coaches: [],
      ballboys: [],
      serviceForBooking: {
        status: 'CONFIRMED',
        coaches: [{ id: 'coach', status: 'CONFIRMED', isClubSettled: false }],
        ballboys: [{ id: 'ballboy', status: 'CONFIRMED' }],
        serviceBookings: [],
      },
    },
  }
  mocks.invoices.mockResolvedValue([original, extra])
  const sources = await getIncomeBySourceAnalytics(start, end)
  const services = buildServiceIncome([original, extra])
  expect(sources.summary.revenueBreakdown).toEqual({
    court: 325000,
    coach: 200000,
    ballboy: 75000,
    other: 0,
  })
  expect(sources.summary.totalNetAmount).toBe(600000)
  expect(services.summary).toMatchObject({
    coachAmount: 200000,
    ballboyAmount: 75000,
    sessions: 2,
  })
  expect(services.rows.filter((row) => row.hours === 0)).toHaveLength(2)
  original.booking.coaches[0].status = 'CANCELLED'
  extra.booking.serviceForBooking.coaches[0].status = 'CANCELLED'
  const cancelledSources = await getIncomeBySourceAnalytics(start, end)
  const cancelledServices = buildServiceIncome([original, extra])
  expect(cancelledSources.summary.revenueBreakdown).toEqual({
    court: 325000,
    coach: 0,
    ballboy: 75000,
    other: 0,
  })
  expect(cancelledSources.summary.totalNetAmount).toBe(400000)
  expect(cancelledServices.summary.coachAmount).toBe(0)
  expect(cancelledServices.summary.ballboyAmount).toBe(75000)
})
