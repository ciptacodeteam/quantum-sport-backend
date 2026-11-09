import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ settle: vi.fn() }))
vi.mock('@/services/coach-club-settlement.service', () => ({
  setCoachClubSettlement: mocks.settle,
}))
import coachingRoute from './coaching.route'
const body = { isSettled: true, expectedIsSettled: false }
function app(role?: string) {
  const a = new Hono<any>()
  a.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  a.route('/admin', coachingRoute)
  return a
}
const request = (role?: string, payload: unknown = body) =>
  app(role).request('/admin/coaching/bookings/line/club-settlement', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.settle.mockResolvedValue({ isClubSettled: true })
})
it.each(['SUPER_ADMIN', 'ADMIN'])(
  'allows %s to record settlement',
  async (role) => {
    expect((await request(role)).status).toBe(200)
    expect(mocks.settle).toHaveBeenCalledWith('line', body, 'actor')
  },
)
it.each([undefined, 'CASHIER', 'ADMIN_VIEWER', 'COACH', 'BALLBOY'])(
  'blocks %s from changing payables',
  async (role) => {
    expect((await request(role)).status).toBe(role ? 403 : 401)
    expect(mocks.settle).not.toHaveBeenCalled()
  },
)
it.each([
  { isSettled: 'false', expectedIsSettled: false },
  { isSettled: true },
  { ...body, actorId: 'fake' },
])('rejects invalid payload %j', async (payload) => {
  expect((await request('ADMIN', payload)).status).toBe(422)
  expect(mocks.settle).not.toHaveBeenCalled()
})

it.each([true, false])(
  'blocks cashiers from setting settlement to %s',
  async (isSettled) => {
    expect(
      (await request('CASHIER', { isSettled, expectedIsSettled: !isSettled }))
        .status,
    ).toBe(403)
    expect(mocks.settle).not.toHaveBeenCalled()
  },
)
