import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { coachingGroup: { findMany: mocks.list } },
}))
vi.mock('@/services/coaching-group.service', async (original) => ({
  ...(await original<typeof import('@/services/coaching-group.service')>()),
  saveCoachingGroup: mocks.save,
}))
import route from './coaching-group.route'
const app = (role?: string) => {
  const a = new Hono<any>()
  a.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  a.route('/admin', route)
  return a
}
const input = {
  name: 'Northwest',
  description: '',
  logo: '',
  sports: ['PADEL', 'TENNIS'],
  branchIds: ['cemara'],
  isActive: true,
}
const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([])
  mocks.save.mockResolvedValue({ id: 'northwest' })
})
it('lets a super admin create a shared group and limits list results to the requested branch', async () => {
  expect(
    (await app('SUPER_ADMIN').request('/admin/coaching-groups', post(input)))
      .status,
  ).toBe(201)
  expect(mocks.save).toHaveBeenCalledWith(undefined, input)
  expect(
    (await app('ADMIN').request('/admin/coaching-groups?branchId=cemara'))
      .status,
  ).toBe(200)
  expect(mocks.list.mock.calls[0][0].where).toEqual({
    branches: { some: { branchId: 'cemara' } },
  })
})
it.each(['ADMIN', 'CASHIER', 'ADMIN_VIEWER', 'COACH', 'BALLBOY', undefined])(
  'blocks group changes by %s',
  async (role) => {
    expect([401, 403]).toContain(
      (await app(role).request('/admin/coaching-groups', post(input))).status,
    )
    expect(mocks.save).not.toHaveBeenCalled()
  },
)
it.each([
  { sports: [] },
  { branchIds: [] },
  { logo: 'javascript:alert(1)' },
  { sports: ['PADEL', 'PADEL'] },
  { branchIds: ['cemara', 'cemara'] },
])('rejects invalid group configuration %j', async (change) => {
  expect(
    (
      await app('SUPER_ADMIN').request(
        '/admin/coaching-groups',
        post({ ...input, ...change }),
      )
    ).status,
  ).toBe(422)
  expect(mocks.save).not.toHaveBeenCalled()
})
