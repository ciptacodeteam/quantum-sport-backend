import { expect, it } from 'vitest'
import { managementInHouseRate } from './management-pricing'
const prices = {
  managementCourtHourlyPrice: 200000,
  managementCoachHourlyPrice: 600000,
}
const customer = {
  ...prices,
  isManagement: true,
  managementValidFrom: '2026-11-12',
  managementValidUntil: '2026-11-13',
}
it('uses the account prices and inclusive playing dates', () => {
  expect(
    managementInHouseRate(customer, new Date('2026-11-12T01:00:00Z')),
  ).toEqual({ court: 200000, coach: 600000 })
  expect(managementInHouseRate(customer, '2026-11-13')).not.toBeNull()
  for (const date of ['2026-11-11', '2026-11-14'])
    expect(managementInHouseRate(customer, date)).toBeNull()
  expect(managementInHouseRate(undefined, '2026-11-12')).toBeNull()
  expect(
    managementInHouseRate({ ...customer, isManagement: false }, '2026-11-12'),
  ).toBeNull()
})
it('uses normal pricing independently for each zero or unset account price', () => {
  expect(managementInHouseRate({ isManagement: true }, '2026-11-12')).toBeNull()
  expect(
    managementInHouseRate(
      { ...customer, managementCourtHourlyPrice: 0 },
      '2026-11-12',
    ),
  ).toEqual({ court: null, coach: 600000 })
  expect(
    managementInHouseRate(
      { ...customer, managementCoachHourlyPrice: 0 },
      '2026-11-12',
    ),
  ).toEqual({ court: 200000, coach: null })
  expect(
    managementInHouseRate(
      {
        isManagement: true,
        managementCourtHourlyPrice: 0,
        managementCoachHourlyPrice: 0,
      },
      '2026-11-12',
    ),
  ).toBeNull()
})
it('keeps prices isolated between accounts instead of reading the legacy global tariff', () => {
  expect(
    managementInHouseRate(
      { ...customer, managementCourtHourlyPrice: 120000 },
      '2026-11-12',
    )?.court,
  ).toBe(120000)
  expect(managementInHouseRate(customer, '2026-11-12')?.court).toBe(200000)
})
