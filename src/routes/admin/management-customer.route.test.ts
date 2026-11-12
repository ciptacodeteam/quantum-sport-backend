import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: {
      findUnique: mocks.find,
      create: mocks.create,
      update: mocks.update,
    },
  },
}))
vi.mock('@/handlers/admin/user.handler', () => ({
  banUserHandler: [],
  getAllUsersHandler: [],
  getUserDetailHandler: [],
  sendResetPasswordLinkHandler: [],
  unbanUserHandler: [],
  updateUserHandler: [],
  searchCustomersHandler: [],
  getCustomerMembershipDetailsHandler: [],
  verifyUserPhoneManuallyHandler: [],
}))
import route from './user.route'
const input = {
  name: 'Management Customer',
  phone: '081234567890',
  managementValidFrom: '2026-11-01',
  managementValidUntil: '2026-12-31',
}
function request(
  role: string | undefined,
  method = 'POST',
  body: unknown = input,
) {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  app.route('/admin', route)
  return app.request(
    method === 'POST'
      ? '/admin/customers/management'
      : '/admin/customers/user-1/management',
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.find.mockResolvedValue(null)
  mocks.create.mockResolvedValue({ id: 'new' })
})
it.each(['ADMIN', 'SUPER_ADMIN'])(
  'lets %s create and classify a Management customer',
  async (role) => {
    expect((await request(role)).status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: input.name,
        phone: '+6281234567890',
        isManagement: true,
        source: 'ADMIN_CREATED',
        managementAssignedBy: 'actor',
        managementValidUntil: new Date('2026-12-31T00:00:00Z'),
      }),
    })
    mocks.find.mockResolvedValue({ id: 'user-1' })
    expect((await request(role, 'PUT', { isManagement: false })).status).toBe(
      200,
    )
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        isManagement: false,
        managementAssignedBy: 'actor',
      }),
    })
  },
)
it.each(['CASHIER', 'ADMIN_VIEWER', 'COACH', 'BALLBOY', undefined])(
  'blocks %s before reading or changing Management records',
  async (role) => {
    expect((await request(role)).status).toBe(role ? 403 : 401)
    expect((await request(role, 'PUT', { isManagement: true })).status).toBe(
      role ? 403 : 401,
    )
    expect(mocks.find).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  },
)
it('rejects invalid or reversed dates, duplicate phone and privilege fields', async () => {
  for (const payload of [
    { ...input, managementValidUntil: '2026-02-30' },
    { ...input, managementValidUntil: '2026-10-01' },
    { ...input, role: 'SUPER_ADMIN' },
  ])
    expect((await request('ADMIN', 'POST', payload)).status).toBe(422)
  mocks.find.mockResolvedValue({ id: 'existing' })
  expect((await request('ADMIN')).status).toBe(400)
  expect(mocks.create).not.toHaveBeenCalled()
})
