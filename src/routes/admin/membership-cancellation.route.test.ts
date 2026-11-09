import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ cancel: vi.fn() }))
vi.mock('@/handlers/admin/membership-transaction.handler', () => ({
  approveMembershipTransactionHandler: [(c: any) => c.json({ ok: true })],
  exportMembershipTransactionsToExcelHandler: [],
  getAllMembershipTransactionsHandler: [],
  getMembershipTransactionDetailHandler: [],
  rejectMembershipTransactionHandler: [
    (c: any) => {
      mocks.cancel()
      return c.json({ ok: true })
    },
  ],
  suspendMembershipTransactionHandler: [],
  unsuspendMembershipTransactionHandler: [],
}))
import route from './membership-transaction.route'
function app(role?: string) {
  const a = new Hono<any>()
  a.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  a.route('/admin', route)
  return a
}
beforeEach(() => vi.clearAllMocks())
it.each(['ADMIN', 'SUPER_ADMIN'])(
  'allows %s to cancel or reject memberships',
  async (role) => {
    for (const action of ['cancel', 'reject']) {
      expect(
        (
          await app(role).request(
            `/admin/membership-transactions/id/${action}`,
            { method: 'PUT' },
          )
        ).status,
      ).toBe(200)
    }
    expect(mocks.cancel).toHaveBeenCalledTimes(2)
  },
)
it.each(['CASHIER', 'ADMIN_VIEWER', 'COACH', 'BALLBOY', undefined])(
  'blocks %s on both membership cancellation endpoints',
  async (role) => {
    for (const action of ['cancel', 'reject']) {
      expect(
        (
          await app(role).request(
            `/admin/membership-transactions/id/${action}`,
            { method: 'PUT' },
          )
        ).status,
      ).toBe(role ? 403 : 401)
    }
    expect(mocks.cancel).not.toHaveBeenCalled()
  },
)
it('preserves the cashier payment approval route', async () => {
  expect(
    (
      await app('CASHIER').request(
        '/admin/membership-transactions/id/approve',
        { method: 'PUT' },
      )
    ).status,
  ).toBe(200)
  expect(mocks.cancel).not.toHaveBeenCalled()
})
