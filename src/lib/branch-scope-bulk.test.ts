import { expect, it, vi } from 'vitest'
import { scopeBranchOperation } from './branch-scope'
import type { BranchContext } from './branch-context'
const context = (): BranchContext => ({
  branchId: 'cemara',
  isAdmin: true,
  isSuperAdmin: false,
  created: new Map(),
})
const slots = (count: number, courtId = 'court') =>
  Array.from({ length: count }, (_, index) => ({
    courtId,
    type: 'COURT',
    startAt: new Date(Date.UTC(2040, 0, 1, index)),
    endAt: new Date(Date.UTC(2040, 0, 1, index + 1)),
  }))
it('checks a shared court reference once for a large bulk slot generation and still scopes every row', async () => {
  const findFirst = vi.fn().mockResolvedValue({ id: 'court' })
  const args = { data: slots(2000), skipDuplicates: true }
  await scopeBranchOperation(
    { court: { findFirst } },
    'Slot',
    'createMany',
    args,
    context(),
  )
  expect(findFirst).toHaveBeenCalledOnce()
  expect(findFirst).toHaveBeenCalledWith({
    where: { id: 'court', AND: [{ branchId: 'cemara' }] },
    select: { id: true },
  })
  expect(args.data.every((row: any) => row.branchId === 'cemara')).toBe(true)
})
it('validates different reference IDs and rejects a cross-branch reference inside the same batch', async () => {
  const findFirst = vi
    .fn()
    .mockImplementation(async ({ where }) =>
      where.id === 'court' ? { id: 'court' } : null,
    )
  await expect(
    scopeBranchOperation(
      { court: { findFirst } },
      'Slot',
      'createMany',
      { data: [...slots(10), ...slots(1, 'other-branch-court')] },
      context(),
    ),
  ).rejects.toThrow('tidak tersedia di cabang ini')
  expect(findFirst).toHaveBeenCalledTimes(2)
})
it('revalidates references on the next operation rather than retaining stale request-wide permissions', async () => {
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce({ id: 'court' })
    .mockResolvedValueOnce(null)
  const db = { court: { findFirst } },
    ctx = context()
  await scopeBranchOperation(db, 'Slot', 'createMany', { data: slots(10) }, ctx)
  await expect(
    scopeBranchOperation(db, 'Slot', 'createMany', { data: slots(10) }, ctx),
  ).rejects.toThrow('tidak tersedia di cabang ini')
  expect(findFirst).toHaveBeenCalledTimes(2)
})
