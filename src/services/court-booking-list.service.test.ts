import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { booking: { findMany: mocks.list, count: mocks.count } },
}))
import {
  getCourtBookingList,
  courtBookingListSchema,
  courtBookingSearchWhere,
  courtBookingOrder,
} from './court-booking-list.service'
import {
  getCourtBookingTableHandler,
  exportBookingsHandler,
} from '@/handlers/admin/booking.handler'
const app = new Hono<any>()
app.use('*', async (c, next) => {
  c.set('logger', { fatal: vi.fn() })
  await next()
})
app.get('/table', ...getCourtBookingTableHandler)
app.get('/export', ...exportBookingsHandler)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([])
  mocks.count.mockResolvedValue(43)
})
it('defaults to ten lightweight bookings and returns the total for pagination', async () => {
  const response = await app.request('/table?courtSport=PADEL')
  expect(response.status).toBe(200)
  expect(((await response.json()) as any).data).toEqual({
    items: [],
    total: 43,
    page: 1,
    limit: 10,
  })
  const query = mocks.list.mock.calls[0][0]
  expect(query).toMatchObject({
    skip: 0,
    take: 10,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  for (const relation of ['coaches', 'ballboys', 'inventories'])
    expect(query.include[relation]).toBeUndefined()
  expect(query.include.invoice.select.payment).toBeUndefined()
  expect(mocks.count).toHaveBeenCalledWith({ where: query.where })
})
it.each(['PADEL', 'TENNIS'] as const)(
  'applies %s scope, playing dates, membership and search to every page and to the count',
  async (courtSport) => {
    const parsed = courtBookingListSchema.parse({
      courtSport,
      page: '3',
      limit: '20',
      checkoutType: 'membership',
      dateFrom: '2026-11-03',
      dateTo: '2026-11-03',
      search: 'INV-008',
      sortBy: 'customer',
      order: 'asc',
    })
    await getCourtBookingList(parsed)
    const query = mocks.list.mock.calls[0][0]
    expect(query.skip).toBe(40)
    expect(query.take).toBe(20)
    expect(query.where.AND[0]).toEqual({
      details: { some: { court: { sport: courtSport } } },
    })
    expect(query.where.AND[1].OR).toContainEqual({
      membershipUserId: { not: null },
    })
    expect(query.where.AND[2].details.some.slot.startAt).toEqual({
      gte: new Date('2026-11-03T00:00:00Z'),
      lt: new Date('2026-11-04T00:00:00Z'),
    })
    expect(query.where.AND[3]).toEqual(courtBookingSearchWhere('INV-008'))
    expect(query.orderBy).toEqual([{ user: { name: 'asc' } }, { id: 'asc' }])
    expect(mocks.count.mock.calls[0][0].where).toEqual(query.where)
  },
)
it('exports all matching rows with the same search and order, without the page limit', async () => {
  const response = await app.request(
    '/export?courtSport=TENNIS&checkoutType=regular&search=Budi&dateFrom=2026-11-03&dateTo=2026-11-04&sortBy=invoice&order=asc',
  )
  expect(response.status).toBe(200)
  const query = mocks.list.mock.calls[0][0]
  expect(query.take).toBeUndefined()
  expect(query.skip).toBeUndefined()
  expect(query.where.details.some.court.sport).toBe('TENNIS')
  expect(query.where.AND).toContainEqual(courtBookingSearchWhere('Budi'))
  expect(query.where.AND).toContainEqual({
    purpose: 'REGULAR',
    membershipUserId: null,
    membershipSessionsUsed: 0,
  })
  expect(query.orderBy).toEqual(
    courtBookingOrder({ sortBy: 'invoice', order: 'asc' }),
  )
})
it.each([
  'page=0',
  'page=-1',
  'page=bad',
  'limit=0',
  'limit=101',
  'sortBy=unknown',
  'order=invalid',
  'dateFrom=2026-11-04&dateTo=2026-11-03',
])('rejects invalid or unbounded table input: %s', async (params) => {
  expect((await app.request(`/table?${params}`)).status).toBe(422)
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.count).not.toHaveBeenCalled()
})
