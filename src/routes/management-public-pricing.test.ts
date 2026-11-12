import { expect, it, vi } from 'vitest'
import { Hono } from 'hono'
vi.mock('@/services/tariff-policy.service', () => ({
  getTariffPeriods: async () => [
    {
      id: 'rule',
      inHouseCourtHourlyPrice: 250000,
      managementCourtHourlyPrice: 200000,
      managementCoachHourlyPrice: 600000,
    },
  ],
}))
vi.mock('@/handlers/court.handler', () => ({
  getCourtBookingWindowHandler: [],
  getAllCourtHandler: [],
  getAvailableCourtSlotsHandler: [],
  getCourtHandler: [],
  getCourtSlotsHandler: [],
}))
import route from './court.route'
it('keeps special Management rates out of the public website tariff response', async () => {
  const app = new Hono<any>().route('/', route)
  const response = await app.request('/courts/tariff-periods')
  expect(response.status).toBe(200)
  const body = (await response.json()) as { data: { rules: unknown[] } }
  expect(body.data.rules).toEqual([
    { id: 'rule', inHouseCourtHourlyPrice: 250000 },
  ])
})
