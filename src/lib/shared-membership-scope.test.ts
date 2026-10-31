import { expect, it } from 'vitest'
import { branchWhere } from './branch-scope'
const context = { branchId: 's-parman', isAdmin: true, isSuperAdmin: false }
it('does not restrict old products or quota by legacy eligible-branch links', () => {
  expect(branchWhere('Membership', context)).toBeNull()
  expect(branchWhere('MembershipBenefit', context)).toBeNull()
  expect(
    branchWhere('MembershipUser', { ...context, membershipMode: 'wallet' }),
  ).toBeNull()
})
it('retains branch ownership of financial sales, invoices, and court reservations', () => {
  expect(
    branchWhere('MembershipUser', { ...context, membershipMode: 'sales' }),
  ).toEqual({ invoice: { branchId: 's-parman' } })
  expect(branchWhere('Invoice', context)).toEqual({ branchId: 's-parman' })
  expect(branchWhere('Booking', context)).toEqual({ branchId: 's-parman' })
  expect(branchWhere('BookingDetail', context)).toEqual({
    booking: { branchId: 's-parman' },
  })
})
