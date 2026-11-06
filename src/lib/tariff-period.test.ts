import { describe, expect, it } from 'vitest'
import {
  tariffPeriodSchema,
  defaultTariffPeriod,
  resolveTariffPeriod,
  tariffBand,
  type TariffRule,
} from './tariff-period'
import { isSlotAllowedForMembershipType } from './membership-hours'
import {
  buildRollingCourtSlots,
  rollingCourtPricingSchema,
} from './rolling-booking-window'
import { formatClubWallClock } from './club-time'

const rule: TariffRule = {
  branchId: 'cemara',
  sport: 'PADEL',
  effectiveFrom: '2026-11-01',
  happyStart: 8,
  happyEnd: 17,
  peakStart: 17,
  peakEnd: 23,
}
describe('effective-dated tariff periods', () => {
  it('isolates branch, sport, and effective date, with the latest applicable version winning', () => {
    const rules = [
      rule,
      { ...rule, effectiveFrom: '2026-12-01', happyEnd: 16, peakStart: 16 },
    ]
    expect(
      resolveTariffPeriod(
        rules,
        '2026-10-31T23:00:00+07:00',
        'cemara',
        'PADEL',
      ),
    ).toEqual(defaultTariffPeriod)
    expect(
      resolveTariffPeriod(rules, '2026-11-01T08:00:00+07:00', 'cemara', 'PADEL')
        .happyEnd,
    ).toBe(17)
    expect(
      resolveTariffPeriod(rules, '2026-12-01T08:00:00+07:00', 'cemara', 'PADEL')
        .happyEnd,
    ).toBe(16)
    expect(
      resolveTariffPeriod(rules, '2026-12-01', 's-parman', 'PADEL'),
    ).toEqual(defaultTariffPeriod)
    expect(
      resolveTariffPeriod(rules, '2026-12-01', 'cemara', 'TENNIS'),
    ).toEqual(defaultTariffPeriod)
  })
  it('uses Jakarta wall dates and handles slot end boundaries', () => {
    expect(
      resolveTariffPeriod([rule], '2026-11-01T00:00:00Z', 'cemara', 'PADEL')
        .happyEnd,
    ).toBe(17)
    expect(
      tariffBand('2026-11-01T09:00:00Z', rule, '2026-11-01T10:00:00Z'),
    ).toBe('happyHour')
    expect(tariffBand('2026-11-01T17:00:00Z', rule)).toBe('peakHour')
    expect(
      tariffBand(
        '2026-11-01T16:30:00+07:00',
        rule,
        '2026-11-01T17:30:00+07:00',
      ),
    ).toBeNull()
    expect(tariffBand('2026-11-01T23:00:00+07:00', rule)).toBeNull()
  })
  it('enforces configured Value Pack bands for full slot durations', () => {
    const options = {
      rules: [rule],
      branchId: 'cemara',
      sport: 'PADEL',
      endAt: '2026-11-01T17:00:00+07:00',
    }
    expect(
      isSlotAllowedForMembershipType(
        'HAPPY_HOUR',
        '2026-11-01T16:00:00+07:00',
        options,
      ),
    ).toBe(true)
    expect(
      isSlotAllowedForMembershipType(
        'AFTER_HOUR',
        '2026-11-01T16:00:00+07:00',
        options,
      ),
    ).toBe(false)
    expect(
      isSlotAllowedForMembershipType(
        'ALL_HOUR',
        '2026-11-01T16:00:00+07:00',
        options,
      ),
    ).toBe(true)
    expect(
      isSlotAllowedForMembershipType(
        'AFTER_HOUR',
        '2026-11-01T17:00:00+07:00',
        { ...options, endAt: '2026-11-01T18:00:00+07:00' },
      ),
    ).toBe(true)
  })
  it.each([
    { happyStart: -1 },
    { happyStart: 8.5 },
    { happyEnd: 8 },
    { peakEnd: 25 },
    { peakStart: 16 },
    { peakStart: 18 },
    { effectiveFrom: '2026-02-30' },
    { sport: 'FOOTBALL' },
  ])('rejects invalid periods %j', (patch) => {
    expect(tariffPeriodSchema.safeParse({ ...rule, ...patch }).success).toBe(
      false,
    )
  })
  it('builds future slots with the effective period and keeps bulk pricing overrides', () => {
    const config = rollingCourtPricingSchema.parse({
      courtId: 'court',
      months: 1,
      days: [1, 2, 3, 4, 5, 6, 7],
      happyHourPrice: 100,
      peakHourPrice: 200,
    })
    const now = new Date('2026-10-30T00:00:00Z')
    const slots = buildRollingCourtSlots(config, 'cemara', now, now, [rule])
    const at = (date: string) =>
      slots.find(
        (slot) =>
          formatClubWallClock(slot.startAt, 'YYYY-MM-DD HH:mm') === date,
      )
    expect(at('2026-10-31 16:00')?.price).toBe(200)
    expect(at('2026-11-01 16:00')?.price).toBe(100)
    expect(at('2026-11-01 07:00')).toBeUndefined()
    expect(at('2026-11-01 23:00')).toBeUndefined()
    const bulk = buildRollingCourtSlots(
      {
        ...config,
        bulkRules: [
          {
            kind: 'pricing',
            fromDate: '2026-11-01',
            days: [7],
            startHour: 16,
            endHour: 17,
            price: 500,
            discountPrice: 400,
          },
        ],
      },
      'cemara',
      now,
      now,
      [rule],
    )
    expect(
      bulk.find(
        (slot) =>
          formatClubWallClock(slot.startAt, 'YYYY-MM-DD HH:mm') ===
          '2026-11-01 16:00',
      ),
    ).toMatchObject({ price: 500, discountPrice: 400 })
  })
})

it.each(['2026-11-07', '2026-11-08'])(
  'uses Happy Hour for all open hours on %s',
  (date) => {
    const weekendRule = { ...rule, happyAllDayDays: [6, 7] }
    const bands = resolveTariffPeriod([weekendRule], date, 'cemara', 'PADEL')
    expect(tariffBand(`${date}T20:00:00Z`, bands, `${date}T21:00:00Z`)).toBe(
      'happyHour',
    )
    expect(tariffBand(`${date}T07:00:00Z`, bands)).toBeNull()
    expect(tariffBand(`${date}T23:00:00Z`, bands)).toBeNull()
    expect(weekendRule.happyEnd).toBe(17)
    const weekday = resolveTariffPeriod(
      [weekendRule],
      '2026-11-09',
      'cemara',
      'PADEL',
    )
    expect(tariffBand('2026-11-09T20:00:00Z', weekday)).toBe('peakHour')
  },
)
it('generates Happy Hour weekend prices, keeps closed hours and midnight boundaries', () => {
  const config = rollingCourtPricingSchema.parse({
    courtId: 'court',
    months: 1,
    days: [1, 2, 3, 4, 5, 6, 7],
    happyHourPrice: 150000,
    peakHourPrice: 300000,
    closedHours: [12],
  })
  const now = new Date('2026-11-06T00:00:00Z')
  const slots = buildRollingCourtSlots(config, 'cemara', now, now, [
    { ...rule, peakEnd: 24, happyAllDayDays: [6, 7] },
  ])
  const at = (date: string) =>
    slots.find(
      (slot) => formatClubWallClock(slot.startAt, 'YYYY-MM-DD HH:mm') === date,
    )
  expect(at('2026-11-07 20:00')?.price).toBe(150000)
  expect(at('2026-11-08 20:00')?.price).toBe(150000)
  expect(at('2026-11-09 20:00')?.price).toBe(300000)
  expect(at('2026-11-07 12:00')).toBeUndefined()
  expect(at('2026-11-07 07:00')).toBeUndefined()
  expect(formatClubWallClock(at('2026-11-07 23:00')!.endAt)).toBe(
    '2026-11-08 00:00:00',
  )
})
it.each([{ days: [0] }, { days: [8] }, { days: [6, 6] }, { days: [1.5] }])(
  'rejects invalid or repeated weekdays $days',
  ({ days }) => {
    expect(
      tariffPeriodSchema.safeParse({ ...rule, happyAllDayDays: days }).success,
    ).toBe(false)
  },
)

it('accepts empty, weekend and full-week day selections', () => {
  for (const days of [[], [6, 7], [1, 2, 3, 4, 5, 6, 7]])
    expect(
      tariffPeriodSchema.safeParse({ ...rule, happyAllDayDays: days }).success,
    ).toBe(true)
})
