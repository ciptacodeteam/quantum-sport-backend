import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { requireAdmin } from '@/middlewares/auth'
const mocks = vi.hoisted(() => ({ remove: vi.fn(), active: vi.fn() }))
vi.mock('@/services/coaching-profile-lifecycle.service', () => ({
  deleteUnusedCoachingProfile: mocks.remove,
  setCoachingProfileActive: mocks.active,
}))
import {
  deleteCoachingProfileHandler,
  setCoachingProfileActiveHandler,
} from './coaching-profile-lifecycle.handler'
beforeEach(() => vi.clearAllMocks())
function request(role: string | null, method = 'DELETE', body?: unknown) {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  app.delete('/:id', requireAdmin, ...deleteCoachingProfileHandler)
  app.patch('/:id/status', requireAdmin, ...setCoachingProfileActiveHandler)
  return app.request(method === 'DELETE' ? '/coach' : '/coach/status', {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
}
it.each(['ADMIN', 'SUPER_ADMIN'])(
  'allows %s to manage coach status and deletion',
  async (role) => {
    expect((await request(role)).status).toBe(200)
    expect(mocks.remove).toHaveBeenCalledWith('coach')
    expect((await request(role, 'PATCH', { isActive: false })).status).toBe(200)
    expect(mocks.active).toHaveBeenCalledWith('coach', false)
  },
)
it.each([null, 'CASHIER', 'ADMIN_VIEWER', 'COACH', 'BALLBOY'])(
  'blocks lifecycle changes by %s',
  async (role) => {
    expect((await request(role)).status).toBe(role ? 403 : 401)
    expect((await request(role, 'PATCH', { isActive: false })).status).toBe(
      role ? 403 : 401,
    )
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.active).not.toHaveBeenCalled()
  },
)
it('rejects malformed status payloads and additional profile changes', async () => {
  expect((await request('ADMIN', 'PATCH', { isActive: 'false' })).status).toBe(
    422,
  )
  expect(
    (await request('ADMIN', 'PATCH', { isActive: false, name: 'Other' }))
      .status,
  ).toBe(422)
  expect(mocks.active).not.toHaveBeenCalled()
})
