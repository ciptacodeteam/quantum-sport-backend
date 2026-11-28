import { expect, it } from 'vitest'
import { branchWhere, scopeBranchOperation } from './branch-scope'
import type { BranchContext } from './branch-context'

const context: BranchContext = {
  branchId: 'cemara',
  isAdmin: true,
  isSuperAdmin: false,
  created: new Map(),
}

it.each([
  { id: true, name: true },
  { id: true, name: true, email: true, role: true },
])('preserves booking creator identity for admin views: %j', async (select) => {
  const args = await scopeBranchOperation(
    {},
    'Booking',
    'findMany',
    { include: { cashier: { select } } },
    context,
  )
  expect(args.where).toEqual({ AND: [{ branchId: 'cemara' }] })
  expect(args.include.cashier).toEqual({ select })
  expect(branchWhere('Staff', context)).toEqual({
    branchId: 'cemara',
    role: { not: 'SUPER_ADMIN' },
  })
})

it.each([
  true,
  { select: { id: true, password: true } },
  { select: { name: true, authTokens: true } },
  { include: { authTokens: true } },
])('keeps staff restrictions for broader cashier reads: %j', async (cashier) => {
  const args = await scopeBranchOperation(
    {},
    'Booking',
    'findMany',
    { include: { cashier } },
    context,
  )
  expect(args.include.cashier.where).toEqual({
    AND: [{ branchId: 'cemara', role: { not: 'SUPER_ADMIN' } }],
  })
})

it('preserves creator identity through nested booking selects', async () => {
  const args = await scopeBranchOperation(
    {},
    'Invoice',
    'findMany',
    { select: { booking: { select: { cashier: { select: { name: true } } } } } },
    context,
  )
  expect(args.select.booking.where).toEqual({ AND: [{ branchId: 'cemara' }] })
  expect(args.select.booking.select.cashier).toEqual({ select: { name: true } })
})
