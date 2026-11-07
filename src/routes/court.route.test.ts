import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'
vi.mock('@/lib/create-app', () => ({ createRouter: () => new Hono() }))
vi.mock('@/handlers/court.handler', () => ({
  getCourtBookingWindowHandler: [(c: any) => c.json({})],
  getAllCourtHandler: [(c: any) => c.json([])],
  getAvailableCourtSlotsHandler: [(c: any) => c.json([])],
  getCourtHandler: [(c: any) => c.json({ error: 'not found' }, 404)],
  getCourtSlotsHandler: [(c: any) => c.json([])],
}))
vi.mock('@/services/tariff-policy.service', () => ({
  getTariffPeriods: vi.fn(),
}))
import courtRoute from './court.route'
it.each([
  ['PUT', '/courts/my-schedule/detail/court'],
  ['GET', '/courts/my-schedule/detail/courts'],
  ['GET', '/courts/my-schedule'],
])(
  'does not expose the former customer court-change endpoint: %s %s',
  async (method, path) => {
    const response = await courtRoute.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'PUT'
        ? { body: JSON.stringify({ sourceSlotId: 'old', newSlotId: 'new' }) }
        : {}),
    })
    expect(response.status).toBe(404)
  },
)
