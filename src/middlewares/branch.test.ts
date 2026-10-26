import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '@/types'
import { branchContext } from '@/lib/branch-context'
const mocks = vi.hoisted(() => ({ staff: vi.fn(), branch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    staff: { findUnique: mocks.staff },
    branch: { findFirst: mocks.branch },
  },
}))
import { branchMiddleware } from './branch'
const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set(
    'admin',
    c.req.path.startsWith('/admin')
      ? { id: 'staff', role: 'ADMIN', email: 'staff@test.invalid' }
      : null,
  )
  await next()
})
app.use('*', branchMiddleware)
app.all('*', (c) =>
  c.json({
    branchId: c.get('branchId'),
    superAdmin: branchContext.getStore()?.isSuperAdmin ?? false,
    membershipMode: branchContext.getStore()?.membershipMode,
  }),
)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.staff.mockResolvedValue({
    role: 'ADMIN',
    branchId: 'cemara',
    isActive: true,
  })
  mocks.branch.mockImplementation(async ({ where }) =>
    ['cemara', 's-parman'].includes(where.id)
      ? { id: where.id, isActive: true }
      : null,
  )
})
it('requires an active branch for public booking and checkout', async () => {
  expect((await app.request('/courts')).status).toBe(400)
  expect(
    (await app.request('/courts', { headers: { 'X-Branch-ID': 'missing' } }))
      .status,
  ).toBe(400)
  const response = await app.request('/courts', {
    headers: { 'X-Branch-ID': 's-parman' },
  })
  expect(await response.json()).toMatchObject({ branchId: 's-parman' })
})
it('uses the database staff assignment and rejects headers for other branches', async () => {
  expect(
    (
      await app.request('/admin/courts', {
        headers: { 'X-Branch-ID': 's-parman' },
      })
    ).status,
  ).toBe(403)
  expect(
    (await app.request('/admin/courts', { headers: { 'X-Branch-ID': 'all' } }))
      .status,
  ).toBe(403)
  expect(await (await app.request('/admin/courts')).json()).toMatchObject({
    branchId: 'cemara',
    superAdmin: false,
  })
})
it('allows the actual super admin to select a branch or read combined data despite an old token role', async () => {
  mocks.staff.mockResolvedValue({
    role: 'SUPER_ADMIN',
    branchId: 'cemara',
    isActive: true,
  })
  expect(await (await app.request('/admin/courts')).json()).toMatchObject({
    branchId: null,
    superAdmin: true,
  })
  expect(
    await (
      await app.request('/admin/courts', {
        headers: { 'X-Branch-ID': 's-parman' },
      })
    ).json(),
  ).toMatchObject({ branchId: 's-parman', superAdmin: true })
})
it('keeps customer history shared while scoping active membership eligibility', async () => {
  expect((await app.request('/memberships/my/tracking')).status).toBe(200)
  expect((await app.request('/memberships/my')).status).toBe(200)
  expect((await app.request('/memberships/my/active')).status).toBe(400)
  expect((await app.request('/invoices/INV-TEST')).status).toBe(200)
})
it('uses the selling branch for financial reports and membership transaction administration', async () => {
  expect(await (await app.request('/admin/analytics')).json()).toMatchObject({
    membershipMode: 'sales',
  })
  expect(
    await (await app.request('/admin/membership-transactions')).json(),
  ).toMatchObject({ membershipMode: 'sales' })
  expect(await (await app.request('/admin/checkout')).json()).toMatchObject({
    membershipMode: 'wallet',
  })
})
it('does not leak the selected branch across concurrent requests', async () => {
  const responses = await Promise.all(
    ['cemara', 's-parman'].map((id) =>
      app.request('/courts', { headers: { 'X-Branch-ID': id } }),
    ),
  )
  expect(await responses[0].json()).toMatchObject({ branchId: 'cemara' })
  expect(await responses[1].json()).toMatchObject({ branchId: 's-parman' })
  expect(branchContext.getStore()).toBeUndefined()
})
