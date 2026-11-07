import { Hono } from 'hono'
import { createFactory } from 'hono/factory'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AppEnv } from '@/types'
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rows: vi.fn(),
  options: vi.fn(),
  change: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({ factory: createFactory<AppEnv>() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: { findUnique: mocks.user },
    bookingDetail: { findMany: mocks.rows },
  },
}))
vi.mock('@/lib/token', () => ({ validateToken: vi.fn() }))
vi.mock('@/services/customer-court-change.service', () => ({
  getCustomerCourtChangeOptions: mocks.options,
  changeCustomerCourt: mocks.change,
}))
import {
  getMyCourtScheduleHandler,
  getCourtChangeOptionsHandler,
  changeCustomerCourtHandler,
} from './customer-court-change.handler'
const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('user', c.req.header('X-Test-User') ? ({ id: 'me' } as never) : null)
  c.set('branchId', c.req.header('X-Branch-ID') ?? null)
  await next()
})
app.onError((err, c) =>
  c.json(
    { message: err.message },
    ('status' in err ? err.status : 500) as never,
  ),
)
app.get('/my-schedule', ...getMyCourtScheduleHandler)
app.get('/my-schedule/:id/courts', ...getCourtChangeOptionsHandler)
app.put('/my-schedule/:id/court', ...changeCustomerCourtHandler)
const headers = {
  'X-Test-User': 'me',
  'X-Branch-ID': 'cemara',
  'Content-Type': 'application/json',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ id: 'me', banned: false })
  mocks.rows.mockResolvedValue([])
  mocks.options.mockResolvedValue([])
  mocks.change.mockResolvedValue({ slotId: 'new' })
})
it.each([
  ['GET', '/my-schedule?date=2030-01-02&courtSport=TENNIS'],
  ['GET', '/my-schedule/detail/courts'],
  ['PUT', '/my-schedule/detail/court'],
])('requires customer authentication for %s %s', async (method, path) => {
  const response = await app.request(path, {
    method,
    headers: { 'X-Branch-ID': 'cemara' },
  })
  expect(response.status).toBe(401)
  expect(mocks.rows).not.toHaveBeenCalled()
  expect(mocks.options).not.toHaveBeenCalled()
  expect(mocks.change).not.toHaveBeenCalled()
})
it('rejects banned accounts', async () => {
  mocks.user.mockResolvedValue({ id: 'me', banned: true })
  const response = await app.request('/my-schedule/detail/courts', { headers })
  expect(response.status).toBe(403)
  expect(mocks.options).not.toHaveBeenCalled()
})
it('rejects injected identity, price or schedule fields', async () => {
  const response = await app.request('/my-schedule/detail/court', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      sourceSlotId: 'old',
      newSlotId: 'new',
      userId: 'other',
      price: 0,
      startAt: '2040-01-01',
    }),
  })
  expect(response.status).toBe(422)
  expect(mocks.change).not.toHaveBeenCalled()
})
it('uses only the authenticated customer and selected branch for a move', async () => {
  const response = await app.request('/my-schedule/detail/court', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ sourceSlotId: 'old', newSlotId: 'new' }),
  })
  expect(response.status).toBe(200)
  expect(mocks.change).toHaveBeenCalledWith('me', 'cemara', 'detail', {
    sourceSlotId: 'old',
    newSlotId: 'new',
  })
})
it('requires a branch for customer mutations', async () => {
  const response = await app.request('/my-schedule/detail/courts', {
    headers: { 'X-Test-User': 'me' },
  })
  expect(response.status).toBe(400)
  expect(mocks.options).not.toHaveBeenCalled()
})
it('scopes the schedule to paid future bookings owned by this customer', async () => {
  const response = await app.request(
    '/my-schedule?date=2030-01-02&courtSport=TENNIS',
    { headers },
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(mocks.rows.mock.calls[0][0].where).toMatchObject({
    booking: {
      userId: 'me',
      branchId: 'cemara',
      status: 'CONFIRMED',
      purpose: 'REGULAR',
      invoice: { status: 'PAID' },
    },
    slot: {
      type: 'COURT',
      court: { sport: 'TENNIS' },
      startAt: {
        gte: new Date('2030-01-02T00:00:00Z'),
        lt: new Date('2030-01-03T00:00:00Z'),
        gt: expect.any(Date),
      },
    },
  })
})
it('rejects invalid calendar dates', async () => {
  const response = await app.request(
    '/my-schedule?date=2030-02-31&courtSport=TENNIS',
    { headers },
  )
  expect(response.status).toBe(422)
  expect(mocks.rows).not.toHaveBeenCalled()
})
