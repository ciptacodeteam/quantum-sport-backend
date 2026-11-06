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
it('keeps all purchases visible regardless of their current remaining quota', async () => {
  const r = await withBranchContext(
    { branchId: 'cemara', isAdmin: true, isSuperAdmin: false },
    () => app.request('/'),
  )
  expect(r.status).toBe(200)
  expect(mocks.find.mock.calls[0][0].where.AND[1]).toEqual({})
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

it.each(['all', 'nonnegative', 'negative'])(
  'applies full WIB purchase days consistently to the %s balance list and Excel export',
  async (balance) => {
    const params = `balance=${balance}&sport=TENNIS&dateFrom=2026-11-03&dateTo=2026-11-03`
    for (const path of ['/', '/export']) {
      mocks.find.mockClear()
      expect((await app.request(`${path}?${params}`)).status).toBe(200)
      const where = mocks.find.mock.calls[0][0].where
      expect(where.AND[0]).toMatchObject({
        membership: { sport: 'TENNIS' },
        createdAt: {
          gte: new Date('2026-11-02T17:00:00Z'),
          lt: new Date('2026-11-03T17:00:00Z'),
        },
      })
      expect(where.AND[1]).toEqual(
        balance === 'all'
          ? {}
          : {
              remainingSessions:
                balance === 'negative' ? { lt: 0 } : { gte: 0 },
            },
      )
    }
  },
)
it('rejects an inverted purchase range before querying either report', async () => {
  for (const path of ['/', '/export'])
    expect(
      (await app.request(`${path}?dateFrom=2026-11-04&dateTo=2026-11-03`))
        .status,
    ).toBe(422)
  expect(mocks.find).not.toHaveBeenCalled()
})
