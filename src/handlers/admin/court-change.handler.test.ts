import { Hono } from 'hono'
import { createFactory } from 'hono/factory'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AppEnv } from '@/types'
const mocks = vi.hoisted(() => ({ options: vi.fn(), move: vi.fn() }))
vi.mock('@/lib/create-app', () => ({ factory: createFactory<AppEnv>() }))
vi.mock('@/lib/token', () => ({ validateToken: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: {} }))
vi.mock('@/services/admin-court-change.service', () => ({
  getAdminCourtChangeOptions: mocks.options,
  changeAdminCourt: mocks.move,
}))
import {
  adminCourtChangeOptionsHandler,
  adminChangeCourtHandler,
} from './court-change.handler'
const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  const role = c.req.header('X-Test-Role')
  c.set('admin', role ? ({ id: 'admin', role } as never) : null)
  c.set('branchId', c.req.header('X-Branch-ID') ?? null)
  await next()
})
app.onError((err, c) =>
  c.json(
    { message: err.message },
    ('status' in err ? err.status : 500) as never,
  ),
)
app.get('/:id/options', ...adminCourtChangeOptionsHandler)
app.put('/:id/move', ...adminChangeCourtHandler)
const input = { sourceSlotId: 'old', newSlotId: 'new' }
const request = (role?: string, extras = {}) =>
  app.request('/detail/move', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Branch-ID': 'cemara',
      ...(role ? { 'X-Test-Role': role } : {}),
    },
    body: JSON.stringify({ ...input, ...extras }),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.options.mockResolvedValue([])
  mocks.move.mockResolvedValue({ slotId: 'new' })
})
it.each(['ADMIN', 'CASHIER', 'SUPER_ADMIN'])(
  'allows %s to move a customer booking without a customer session',
  async (role) => {
    expect((await request(role)).status).toBe(200)
    expect(mocks.move).toHaveBeenCalledWith('admin', 'cemara', 'detail', input)
  },
)
it.each(['ADMIN_VIEWER', 'COACH', 'BALLBOY'])(
  'blocks writes by %s',
  async (role) => {
    expect((await request(role)).status).toBe(403)
    expect(mocks.move).not.toHaveBeenCalled()
  },
)
it('blocks unauthenticated moves', async () => {
  expect((await request()).status).toBe(401)
  expect(mocks.move).not.toHaveBeenCalled()
})
it('rejects injected prices, times, identities and roles', async () => {
  expect(
    (
      await request('ADMIN', {
        userId: 'other',
        price: 0,
        startAt: '2040-01-01',
        role: 'SUPER_ADMIN',
      })
    ).status,
  ).toBe(422)
  expect(mocks.move).not.toHaveBeenCalled()
})
it('rejects branchless requests from non-super admins', async () => {
  const response = await app.request('/detail/options', {
    headers: { 'X-Test-Role': 'ADMIN' },
  })
  expect(response.status).toBe(403)
  expect(mocks.options).not.toHaveBeenCalled()
})
it('permits a super admin to browse all branches while resolving the source branch on the server', async () => {
  const response = await app.request('/detail/options', {
    headers: { 'X-Test-Role': 'SUPER_ADMIN' },
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(mocks.options).toHaveBeenCalledWith('admin', null, 'detail')
})
