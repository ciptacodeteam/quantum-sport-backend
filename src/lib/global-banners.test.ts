import { expect, it, vi } from 'vitest'
import { branchWhere, scopeBranchOperation } from './branch-scope'
const context = (branchId: string | null) => ({
  branchId,
  isAdmin: true,
  isSuperAdmin: false,
  staffId: 'admin',
  created: new Map<string, Set<string>>(),
})
it('does not filter banners by the selected branch', () => {
  for (const id of ['cemara', 's-parman', null])
    expect(branchWhere('Banner', context(id))).toBeNull()
})
it('allows the same shared banner to be created, read, edited, and deleted from each branch', async () => {
  const db = { branch: { findFirst: vi.fn() } }
  for (const id of ['cemara', 's-parman', null]) {
    const args = { data: { image: '/banner.jpg', isActive: true } }
    expect(
      await scopeBranchOperation(db, 'Banner', 'create', args, context(id)),
    ).toEqual(args)
    expect(args.data).not.toHaveProperty('branchId')
    for (const operation of ['findMany', 'update', 'delete']) {
      const query = { where: { id: 'shared-banner' } }
      expect(
        await scopeBranchOperation(db, 'Banner', operation, query, context(id)),
      ).toEqual(query)
      expect(query.where).not.toHaveProperty('AND')
    }
  }
  expect(db.branch.findFirst).not.toHaveBeenCalled()
})
