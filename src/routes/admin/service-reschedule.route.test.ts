import { Hono } from 'hono'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn() }))
vi.mock('@/services/service-reschedule-context.service', () => ({
  serviceRescheduleContext: mocks.context,
}))
import route from './coaching.route'
function request(role?: string, kind = 'BALLBOY') {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  app.route('/admin', route)
  return app.request(
    `/admin/coaching/bookings/service/reschedule-court?kind=${kind}`,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({
    detail: { id: 'court' },
    membershipCovered: false,
  })
})
it.each(['ADMIN', 'SUPER_ADMIN', 'CASHIER'])(
  'allows %s to resolve a paired court reschedule',
  async (role) => {
    expect((await request(role)).status).toBe(200)
    expect(mocks.context).toHaveBeenCalledWith('BALLBOY', 'service')
  },
)
it.each(['ADMIN_VIEWER', 'COACH', 'BALLBOY', undefined])(
  'rejects %s from reschedule context',
  async (role) => {
    expect((await request(role)).status).toBe(role ? 403 : 401)
    expect(mocks.context).not.toHaveBeenCalled()
  },
)
it('validates the service kind', async () => {
  expect((await request('ADMIN', 'COURT')).status).toBe(422)
  expect(mocks.context).not.toHaveBeenCalled()
})
