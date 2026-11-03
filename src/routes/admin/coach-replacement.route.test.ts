import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ available: vi.fn(), replace: vi.fn() }))
vi.mock('@/services/coach-replacement.service', () => ({
  availableCoachReplacements: mocks.available,
  replaceBookedCoach: mocks.replace,
}))
import route from './coaching.route'
function app(role?: string) {
  const a = new Hono<any>()
  a.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  a.route('/admin', route)
  return a
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.available.mockResolvedValue({ options: [] })
  mocks.replace.mockResolvedValue({ id: 'item' })
})
it.each(['ADMIN', 'SUPER_ADMIN', 'CASHIER'])(
  'allows %s to find and replace coaches using the authenticated actor',
  async (role) => {
    const a = app(role)
    expect(
      (await a.request('/admin/coaching/bookings/item/replacements')).status,
    ).toBe(200)
    const response = await a.request(
      '/admin/coaching/bookings/item/replace-coach',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId: 'next',
          expectedSlotId: 'old',
          reason: 'Berhalangan',
        }),
      },
    )
    expect(response.status).toBe(200)
    expect(mocks.replace).toHaveBeenCalledWith(
      'item',
      { slotId: 'next', expectedSlotId: 'old', reason: 'Berhalangan' },
      'actor',
    )
  },
)
it.each([undefined, 'ADMIN_VIEWER', 'COACH'])(
  'prevents unauthorized role %s from reading choices or changing assignments',
  async (role) => {
    const a = app(role)
    for (const path of ['replacements', 'replace-coach']) {
      const response = await a.request(
        `/admin/coaching/bookings/item/${path}`,
        path === 'replace-coach' ? { method: 'POST' } : {},
      )
      expect([401, 403]).toContain(response.status)
    }
    expect(mocks.available).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  },
)
it.each([
  { slotId: 'next' },
  { expectedSlotId: 'old' },
  { slotId: 'next', expectedSlotId: 'old', price: 1 },
  { slotId: 'next', expectedSlotId: 'old', reason: 'a'.repeat(501) },
])('rejects an invalid reassignment payload %j', async (body) => {
  const response = await app('ADMIN').request(
    '/admin/coaching/bookings/item/replace-coach',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  expect(response.status).toBe(422)
  expect(mocks.replace).not.toHaveBeenCalled()
})
