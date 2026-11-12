import { expect, it } from 'vitest'
import { managementInHouseRate } from './management-pricing'
import { tariffPeriodSchema } from './tariff-period'
const tariff = {
  managementCourtHourlyPrice: 200000,
  managementCoachHourlyPrice: 600000,
}
const customer = {
  isManagement: true,
  managementValidFrom: '2026-11-12',
  managementValidUntil: '2026-11-13',
}
it('uses inclusive playing dates for the approved customer only', () => {
  expect(
    managementInHouseRate(customer, new Date('2026-11-12T01:00:00Z'), tariff),
  ).toEqual({ court: 200000, coach: 600000 })
  expect(managementInHouseRate(customer, '2026-11-13', tariff)).not.toBeNull()
  for (const date of ['2026-11-11', '2026-11-14'])
    expect(managementInHouseRate(customer, date, tariff)).toBeNull()
  expect(managementInHouseRate(undefined, '2026-11-12', tariff)).toBeNull()
  expect(
    managementInHouseRate({ isManagement: false }, '2026-11-12', tariff),
  ).toBeNull()
  expect(managementInHouseRate(customer, '2026-11-12', {})).toBeNull()
})
it('requires both tariff components while allowing explicit free components', () => {
  const input = {
    sport: 'PADEL',
    effectiveFrom: '2026-11-12',
    happyStart: 6,
    happyEnd: 15,
    peakStart: 15,
    peakEnd: 24,
  }
  expect(tariffPeriodSchema.safeParse({ ...input, ...tariff }).success).toBe(
    true,
  )
  expect(
    tariffPeriodSchema.safeParse({
      ...input,
      managementCourtHourlyPrice: 200000,
    }).success,
  ).toBe(false)
  expect(
    tariffPeriodSchema.safeParse({
      ...input,
      managementCourtHourlyPrice: -1,
      managementCoachHourlyPrice: 0,
    }).success,
  ).toBe(false)
  expect(
    managementInHouseRate(customer, '2026-11-12', {
      managementCourtHourlyPrice: 0,
      managementCoachHourlyPrice: 0,
    }),
  ).toEqual({ court: 0, coach: 0 })
})
