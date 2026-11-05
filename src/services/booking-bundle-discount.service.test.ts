import { expect, it } from 'vitest'
import {
  getCourtCoachBundleDiscount,
  getCourtCoachBundleDiscountByCourtSlot,
} from './booking-bundle-discount.service'
import { tariffPeriodSchema, type TariffRule } from '@/lib/tariff-period'
const rule: TariffRule = {
  branchId: 'cemara',
  sport: 'PADEL',
  effectiveFrom: '2026-11-05',
  happyStart: 6,
  happyEnd: 15,
  peakStart: 15,
  peakEnd: 24,
  happyCoachDiscount: 45000,
  peakCoachDiscount: 25000,
}
const court = (hour: number, date = '2026-11-05') => ({
  id: `court-${hour}`,
  branchId: 'cemara',
  court: { sport: 'PADEL' as const },
  startAt: new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00Z`),
  endAt: new Date(`${date}T${(hour + 1).toString().padStart(2, '0')}:00:00Z`),
})
it('uses configured coaching amounts instead of fixed discounts by branch, sport and playing date', () => {
  expect(getCourtCoachBundleDiscount(court(10), [rule])).toBe(45000)
  expect(getCourtCoachBundleDiscount(court(17), [rule])).toBe(25000)
  expect(getCourtCoachBundleDiscount(court(10, '2026-11-04'), [rule])).toBe(0)
  expect(
    getCourtCoachBundleDiscount({ ...court(10), branchId: 'other' }, [rule]),
  ).toBe(0)
  expect(
    getCourtCoachBundleDiscount({ ...court(10), court: { sport: 'TENNIS' } }, [
      rule,
    ]),
  ).toBe(0)
  expect(
    getCourtCoachBundleDiscount({ ...court(10), court: { sport: 'TENNIS' } }, [
      { ...rule, sport: 'TENNIS', happyCoachDiscount: 60000 },
    ]),
  ).toBe(60000)
})
it('discounts only matching court and coach times and uses the latest effective setting', () => {
  const early = court(10),
    late = court(17)
  const rules = [
    rule,
    { ...rule, effectiveFrom: '2026-11-06', happyCoachDiscount: 30000 },
  ]
  expect([
    ...getCourtCoachBundleDiscountByCourtSlot([early, late], [early], rules),
  ]).toEqual([[early.id, 45000]])
  expect(getCourtCoachBundleDiscount(court(10, '2026-11-06'), rules)).toBe(
    30000,
  )
  expect(getCourtCoachBundleDiscountByCourtSlot([early], [], rules).size).toBe(
    0,
  )
  expect(
    getCourtCoachBundleDiscount(early, [{ ...rule, happyCoachDiscount: 0 }]),
  ).toBe(0)
  expect(getCourtCoachBundleDiscount(early, [])).toBe(0)
})
it('rejects negative, fractional and overflowing discount amounts', () => {
  for (const value of [-1, 1.5, 2147483648])
    expect(
      tariffPeriodSchema.safeParse({
        ...rule,
        branchId: undefined,
        happyCoachDiscount: value,
      }).success,
    ).toBe(false)
})
