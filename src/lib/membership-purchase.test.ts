import { expect, it } from 'vitest'
import { membershipAtPurchase, snapshotMembership } from './membership-purchase'

it('retains purchased price, quota, validity and hour type after catalogue changes', () => {
  const original = {
    price: 10000000,
    sessions: 50,
    duration: 91,
    type: 'ALL_HOUR' as const,
  }
  const snapshot = snapshotMembership(original)
  const catalogue = {
    price: 12500000,
    sessions: 100,
    duration: 30,
    type: 'HAPPY_HOUR' as const,
  }
  const pack = { ...snapshot, remainingSessions: 32, membership: catalogue }
  expect(membershipAtPurchase(pack)).toEqual({
    ...snapshot,
    remainingSessions: 32,
    membership: original,
  })
  expect(pack.membership).toEqual(catalogue)
  expect(snapshotMembership(catalogue)).toEqual({
    purchasedPrice: 12500000,
    purchasedSessions: 100,
    purchasedDuration: 30,
    purchasedType: 'HAPPY_HOUR',
  })
})

it('preserves complimentary purchases rather than substituting a new paid price', () => {
  expect(
    membershipAtPurchase({ purchasedPrice: 0, membership: { price: 5000000 } })
      .membership.price,
  ).toBe(0)
})

it('refuses to substitute catalogue terms for unverified historical purchases', () => {
  expect(() =>
    membershipAtPurchase({
      purchasedSessions: null,
      membership: { sessions: 100 },
    }),
  ).toThrow('belum terverifikasi')
})
