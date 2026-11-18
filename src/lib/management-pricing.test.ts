import { expect, it } from 'vitest'
import {
  managementInHouseRate,
  managementCourtRate,
} from './management-pricing'
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
  expect(managementInHouseRate(customer, '2030-11-14')).not.toBeNull()
  for (const date of ['2026-11-11'])
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

it.each([
  ['PADEL', '10:00', 100000],
  ['PADEL', '18:00', 150000],
  ['TENNIS', '10:00', 80000],
  ['TENNIS', '18:00', 120000],
])(
  'uses the standalone %s %s tariff independently of coaching',
  (sport, time, expected) => {
    const account = {
      ...customer,
      managementPadelHappyHourlyPrice: 100000,
      managementPadelPeakHourlyPrice: 150000,
      managementTennisHappyHourlyPrice: 80000,
      managementTennisPeakHourlyPrice: 120000,
    }
    const startAt = new Date(`2026-11-16T${time}:00Z`)
    const slot = {
      startAt,
      endAt: new Date(+startAt + 3600000),
      branchId: 'cemara',
      court: { sport },
    }
    expect(managementCourtRate(account, slot, [])).toBe(expected)
    expect(managementInHouseRate(account, startAt)).toEqual({
      court: 200000,
      coach: 600000,
    })
    expect(
      managementCourtRate({ ...account, isManagement: false }, slot, []),
    ).toBeNull()
    expect(
      managementCourtRate(
        { ...account, managementValidFrom: '2026-11-17' },
        slot,
        [],
      ),
    ).toBeNull()
  },
)
it('resolves branch, sport, effective date and full-day tariff rules and ignores the removed end date', () => {
  const account = {
    ...customer,
    managementPadelHappyHourlyPrice: 100000,
    managementPadelPeakHourlyPrice: 150000,
  }
  const slot = {
    startAt: new Date('2026-11-16T15:00:00Z'),
    endAt: new Date('2026-11-16T16:00:00Z'),
    branchId: 'cemara',
    court: { sport: 'PADEL' },
  }
  const rule = {
    branchId: 'cemara',
    sport: 'PADEL',
    effectiveFrom: '2026-11-01',
    happyStart: 6,
    happyEnd: 16,
    peakStart: 16,
    peakEnd: 24,
  }
  expect(managementCourtRate(account, slot, [rule])).toBe(100000)
  expect(
    managementCourtRate(account, slot, [{ ...rule, branchId: 'other' }]),
  ).toBe(150000)
  expect(
    managementCourtRate(account, slot, [
      { ...rule, effectiveFrom: '2026-12-01' },
    ]),
  ).toBe(150000)
  expect(
    managementCourtRate(
      account,
      {
        ...slot,
        startAt: new Date('2026-11-16T18:00:00Z'),
        endAt: new Date('2026-11-16T19:00:00Z'),
      },
      [{ ...rule, happyAllDayDays: [1] }],
    ),
  ).toBe(100000)
  expect(
    managementCourtRate(
      { ...account, managementPadelPeakHourlyPrice: 0 },
      slot,
      [],
    ),
  ).toBeNull()
  expect(managementCourtRate(customer, slot, [])).toBeNull()
})
