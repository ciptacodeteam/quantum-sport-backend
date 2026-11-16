import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { branchContext, withBranchContext } from '@/lib/branch-context'
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  find: vi.fn(),
  tracking: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    membershipUser: {
      findMany: mocks.list,
      count: mocks.count,
      findFirst: mocks.find,
    },
  },
}))
vi.mock('@/services/membership-tracking.service', () => ({
  getTrackedPackageStatus: () => 'ACTIVE',
  getMembershipTracking: mocks.tracking,
}))
import route from './membership-members.route'

function request(role?: string, path = '') {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'admin', role })
    return withBranchContext(
      {
        branchId: 'cemara',
        isAdmin: true,
        isSuperAdmin: role === 'SUPER_ADMIN',
        membershipMode: 'sales',
      },
      next,
    )
  })
  app.route('/admin', route)
  return app.request(`/admin/analytics/membership-members${path}`)
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.count.mockResolvedValue(0)
  mocks.list.mockResolvedValue([])
  mocks.tracking.mockResolvedValue({ packages: [] })
})
it.each([undefined, 'CASHIER', 'COACH', 'CUSTOMER'])(
  'blocks unauthorized role %s from both endpoints',
  async (role) => {
    expect((await request(role)).status).toBe(role ? 403 : 401)
    expect((await request(role, '/package')).status).toBe(role ? 403 : 401)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.find).not.toHaveBeenCalled()
  },
)
it.each(['ADMIN', 'ADMIN_VIEWER', 'SUPER_ADMIN'])(
  'allows %s to read the report',
  async (role) => {
    const response = await request(role)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { total: 0, page: 1, pageSize: 20, packages: [] },
    })
  },
)
it('searches paid packages with bounded pagination, preserving the complete shared wallet context', async () => {
  mocks.list.mockImplementation(async () => {
    expect(branchContext.getStore()).toMatchObject({
      branchId: null,
      membershipMode: 'wallet',
      isAdmin: true,
    })
    return []
  })
  expect((await request('ADMIN', '?q=Jim&sport=PADEL&page=2')).status).toBe(200)
  expect(mocks.list).toHaveBeenCalledWith(
    expect.objectContaining({
      skip: 20,
      take: 20,
      where: expect.objectContaining({
        invoice: { status: 'PAID' },
        membership: { sport: 'PADEL' },
        OR: expect.any(Array),
      }),
    }),
  )
  expect(mocks.count.mock.calls[0][0].where).toEqual(
    mocks.list.mock.calls[0][0].where,
  )
  expect(branchContext.getStore()).toBeUndefined()
})
it.each(['?page=0', '?page=1.5', '?sport=OTHER', '?page=100001'])(
  'rejects invalid filters %s',
  async (query) => {
    expect((await request('ADMIN', query)).status).toBe(422)
    expect(mocks.list).not.toHaveBeenCalled()
  },
)
it('reads only the selected paid package using the shared customer tracking service', async () => {
  mocks.find.mockResolvedValue({
    id: 'pack',
    userId: 'customer',
    user: { name: 'Jim', phone: null, email: null },
  })
  mocks.tracking.mockResolvedValue({
    packages: [{ id: 'pack', remainingHours: 7 }],
  })
  const response = await request('ADMIN', '/pack')
  expect(response.status).toBe(200)
  expect(mocks.find).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'pack', invoice: { status: 'PAID' } },
    }),
  )
  expect(mocks.tracking).toHaveBeenCalledWith('customer', 'pack')
  expect(await response.json()).toMatchObject({
    data: {
      user: { name: 'Jim' },
      packages: [{ id: 'pack', remainingHours: 7 }],
    },
  })
})
it('does not return tracking for an unpaid or missing package', async () => {
  mocks.find.mockResolvedValue(null)
  expect((await request('ADMIN', '/missing')).status).toBe(404)
  expect(mocks.tracking).not.toHaveBeenCalled()
})
