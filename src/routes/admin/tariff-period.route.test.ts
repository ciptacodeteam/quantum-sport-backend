import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn() }))
vi.mock('@/services/tariff-policy.service', () => ({
  getTariffPeriods: mocks.list,
}))
vi.mock('@/services/tariff-settings.service', () => ({
  saveTariffPeriod: mocks.save,
}))
import route from './tariff-period.route'
const input = {
  sport: 'PADEL',
  effectiveFrom: '2040-01-01',
  happyStart: 6,
  happyEnd: 16,
  peakStart: 16,
  peakEnd: 24,
}
function request(
  role: string,
  method: 'GET' | 'PUT',
  branchId: string | null = 'cemara',
  payload = input,
) {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    c.set('admin', { id: 'staff', role })
    c.set('branchId', branchId)
    await next()
  })
  app.route('/', route)
  return app.request('/tariff-periods', {
    method,
    ...(method === 'PUT'
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      : {}),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([])
  mocks.save.mockResolvedValue({ id: 'rule' })
})
it.each(['ADMIN', 'SUPER_ADMIN'])(
  'allows %s to save only the context branch',
  async (role) => {
    expect((await request(role, 'PUT')).status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith('cemara', input)
  },
)
it.each(['CASHIER', 'ADMIN_VIEWER'])(
  'allows %s to read for booking, but forbids saving',
  async (role) => {
    expect((await request(role, 'GET')).status).toBe(200)
    expect((await request(role, 'PUT')).status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled()
  },
)
it('requires selecting one branch and rejects overlapping hours', async () => {
  expect((await request('SUPER_ADMIN', 'PUT', null)).status).toBe(400)
  expect(
    (await request('ADMIN', 'PUT', 'cemara', { ...input, peakStart: 15 }))
      .status,
  ).toBe(422)
  expect(mocks.save).not.toHaveBeenCalled()
})
