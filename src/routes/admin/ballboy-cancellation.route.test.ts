import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ preview: vi.fn(), cancel: vi.fn() }))
vi.mock('@/services/ballboy-cancellation.service', () => ({
  previewBallboyCancellation: mocks.preview,
  cancelBookedBallboy: mocks.cancel,
}))
import route from './booked-ballboy.route'
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
  mocks.preview.mockResolvedValue({})
  mocks.cancel.mockResolvedValue({ status: 'CANCELLED' })
})
it.each(['SUPER_ADMIN', 'ADMIN', 'CASHIER'])(
  'allows %s to preview and cancel a ballboy',
  async (role) => {
    const a = app(role)
    expect(
      (await a.request('/admin/booked-ballboys/item/cancellation')).status,
    ).toBe(200)
    expect(
      (
        await a.request('/admin/booked-ballboys/item/cancel', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedSlotId: 'slot',
            reason: 'Pelanggan batal',
          }),
        })
      ).status,
    ).toBe(200)
    expect(mocks.cancel).toHaveBeenCalledWith(
      'item',
      { expectedSlotId: 'slot', reason: 'Pelanggan batal' },
      'actor',
    )
  },
)
it.each([undefined, 'ADMIN_VIEWER', 'COACH', 'BALLBOY'])(
  'rejects %s',
  async (role) => {
    const a = app(role)
    expect(
      (await a.request('/admin/booked-ballboys/item/cancellation')).status,
    ).toBe(role ? 403 : 401)
    expect(
      (await a.request('/admin/booked-ballboys/item/cancel', { method: 'PUT' }))
        .status,
    ).toBe(role ? 403 : 401)
    expect(mocks.cancel).not.toHaveBeenCalled()
  },
)
it('requires a reason and the displayed slot version', async () => {
  expect(
    (
      await app('CASHIER').request('/admin/booked-ballboys/item/cancel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '' }),
      })
    ).status,
  ).toBe(422)
  expect(mocks.cancel).not.toHaveBeenCalled()
})
