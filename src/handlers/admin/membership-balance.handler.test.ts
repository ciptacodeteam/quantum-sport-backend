import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { branchContext, withBranchContext } from '@/lib/branch-context'
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  contexts: [] as (string | undefined)[],
}))
vi.mock('@/lib/prisma', () => ({
  db: { membershipUser: { findMany: mocks.find } },
}))
vi.mock('@/services/membership-activation.service', () => ({
  activateMembershipAfterPayment: vi.fn(),
}))
import {
  getAllMembershipTransactionsHandler,
  exportMembershipTransactionsToExcelHandler,
} from './membership-transaction.handler'
const app = new Hono<any>()
app.use('*', async (c, next) => {
  c.set('logger', { fatal: vi.fn() })
  await next()
})
app.get('/', ...getAllMembershipTransactionsHandler)
app.get('/export', ...exportMembershipTransactionsToExcelHandler)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.contexts = []
  mocks.find.mockImplementation(async () => {
    mocks.contexts.push(branchContext.getStore()?.branchId ?? undefined)
    return []
  })
})
it('keeps negative balances out of the ordinary transaction list', async () => {
  const r = await withBranchContext(
    { branchId: 'cemara', isAdmin: true, isSuperAdmin: false },
    () => app.request('/'),
  )
  expect(r.status).toBe(200)
  expect(mocks.find.mock.calls[0][0].where.AND).toContainEqual({
    remainingSessions: { gte: 0 },
  })
  expect(mocks.contexts).toEqual(['cemara'])
})
it('shows the shared negative wallet separately across purchase branches', async () => {
  const r = await withBranchContext(
    { branchId: 's-parman', isAdmin: true, isSuperAdmin: false },
    () => app.request('/?balance=negative&sport=PADEL'),
  )
  expect(r.status).toBe(200)
  const where = mocks.find.mock.calls[0][0].where
  expect(where.AND).toContainEqual({ remainingSessions: { lt: 0 } })
  expect(where.AND[0].membership).toEqual({ sport: 'PADEL' })
  expect(mocks.contexts).toEqual([undefined])
})
it('exports exactly the shared debt scope rather than the normal sales list', async () => {
  const r = await withBranchContext(
    { branchId: 'cemara', isAdmin: true, isSuperAdmin: false },
    () => app.request('/export?balance=negative'),
  )
  expect(r.status).toBe(200)
  expect(r.headers.get('Content-Type')).toContain('spreadsheetml')
  expect(mocks.find.mock.calls[0][0].where.AND).toContainEqual({
    remainingSessions: { lt: 0 },
  })
  expect(mocks.contexts).toEqual([undefined])
})
