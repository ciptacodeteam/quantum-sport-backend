import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ preview: vi.fn(), cancel: vi.fn() }))
vi.mock('@/services/coach-cancellation.service', () => ({
  previewCoachCancellation: mocks.preview,
  cancelBookedCoach: mocks.cancel,
}))
import coachingRoute from './coaching.route'
import bookedCoachRoute from './booked-coach.route'
function app(role?: string) {
  const a = new Hono<any>()
  a.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  a.route('/admin', coachingRoute)
  a.route('/admin', bookedCoachRoute)
  return a
}
const payload = { expectedSlotId: 'old-slot', reason: 'Pelanggan membatalkan' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.preview.mockResolvedValue({ refundRequired: true })
  mocks.cancel.mockResolvedValue({ status: 'CANCELLED' })
})
it.each(['SUPER_ADMIN', 'CASHIER'])(
  'allows %s to preview and cancel on both endpoints',
  async (role) => {
    const a = app(role)
    expect(
      (await a.request('/admin/coaching/bookings/item/cancellation')).status,
    ).toBe(200)
    for (const [path, method] of [
      ['/admin/coaching/bookings/item/cancel-coach', 'POST'],
      ['/admin/booked-coaches/item/cancel', 'PUT'],
    ]) {
      expect(
        (
          await a.request(path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        ).status,
      ).toBe(200)
    }
    expect(mocks.cancel).toHaveBeenCalledTimes(2)
    expect(mocks.cancel).toHaveBeenCalledWith('item', payload, 'actor')
  },
)
it.each([undefined, 'ADMIN', 'ADMIN_VIEWER', 'COACH', 'BALLBOY'])(
  'rejects %s for preview, the new endpoint, and the legacy cancellation endpoint',
  async (role) => {
    const a = app(role)
    for (const [path, method] of [
      ['/admin/coaching/bookings/item/cancellation', 'GET'],
      ['/admin/coaching/bookings/item/cancel-coach', 'POST'],
      ['/admin/booked-coaches/item/cancel', 'PUT'],
    ]) {
      const response = await a.request(path, { method })
      expect(response.status).toBe(role ? 403 : 401)
    }
    expect(mocks.preview).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()
  },
)
it.each([
  { reason: '' },
  { expectedSlotId: 'old', reason: '   ' },
  { reason: 'Alasan' },
  { ...payload, reason: 'a'.repeat(501) },
  { ...payload, refund: true },
])('rejects invalid cancellation payload %j', async (body) => {
  for (const [path, method] of [
    ['/admin/coaching/bookings/item/cancel-coach', 'POST'],
    ['/admin/booked-coaches/item/cancel', 'PUT'],
  ]) {
    expect(
      (
        await app('SUPER_ADMIN').request(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(422)
  }
  expect(mocks.cancel).not.toHaveBeenCalled()
})
