import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '@/types'
import type { Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({ findStaff: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { staff: { findUnique: mocks.findStaff } },
}))
vi.mock('@/services/account-status.service', () => ({
  assertStaffActive: vi.fn(),
}))
import { requireAdminAuth, blockAdminViewerWrites } from './auth'

const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('admin', { id: 'staff-1', email: 'staff@example.com', role: 'ADMIN' })
  await next()
})
app.all('/admin/*', requireAdminAuth, blockAdminViewerWrites, (c) =>
  c.json({ success: true }),
)
beforeEach(() => {
  mocks.findStaff.mockResolvedValue({
    id: 'staff-1',
    isActive: true,
    role: 'ADMIN',
    mustChangePassword: true,
  })
})

it.each([
  ['GET', '/admin/auth/profile'],
  ['POST', '/admin/auth/change-password'],
  ['POST', '/admin/auth/logout'],
])('allows %s %s while a password change is required', async (method, path) => {
  expect((await app.request(path, { method })).status).toBe(200)
})

it.each([
  ['GET', '/admin/analytics'],
  ['POST', '/admin/checkout'],
  ['PUT', '/admin/staffs/staff-1'],
  ['POST', '/admin/auth/profile'],
  ['POST', '/admin/auth/change-password/extra'],
])('blocks %s %s until the password is changed', async (method, path) => {
  expect((await app.request(path, { method })).status).toBe(403)
})

it.each(['ADMIN_VIEWER', 'SUPER_ADMIN'] as Role[])(
  'enforces rotation and allows changing the own password for %s',
  async (role) => {
    mocks.findStaff.mockResolvedValue({
      id: 'staff-1',
      isActive: true,
      role,
      mustChangePassword: true,
    })
    expect(
      (await app.request('/admin/auth/change-password', { method: 'POST' }))
        .status,
    ).toBe(200)
    expect(
      (await app.request('/admin/auth/logout', { method: 'POST' })).status,
    ).toBe(200)
    expect((await app.request('/admin/analytics')).status).toBe(403)
  },
)

it('restores normal access after rotation is complete', async () => {
  mocks.findStaff.mockResolvedValue({
    id: 'staff-1',
    isActive: true,
    role: 'ADMIN',
    mustChangePassword: false,
  })
  expect((await app.request('/admin/analytics')).status).toBe(200)
})
