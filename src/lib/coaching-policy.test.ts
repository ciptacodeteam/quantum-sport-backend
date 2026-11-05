import { describe, expect, it } from 'vitest'
import {
  assertCoachingSport,
  buildCoachingSlots,
  coachingProfileSchema,
  coachingScheduleSchema,
} from './coaching-policy'
const schedule = {
  fromDate: '2026-11-01',
  toDate: '2026-11-01',
  days: [7],
  startHour: 13,
  endHour: 14,
  price: 150000,
}
describe('admin coaching rules', () => {
  it('requires a sport for coaches and rejects impossible schedules', () => {
    expect(
      coachingProfileSchema.safeParse({ name: 'A', kind: 'COACH' }).success,
    ).toBe(false)
    expect(
      coachingProfileSchema.safeParse({ name: 'B', kind: 'BALLBOY' }).success,
    ).toBe(true)
    for (const change of [
      { fromDate: '2026-02-30' },
      { endHour: 13 },
      { days: [] },
      { price: -1 },
      { toDate: '2028-01-01' },
    ])
      expect(
        coachingScheduleSchema.safeParse({ ...schedule, ...change }).success,
      ).toBe(false)
  })
  it('keeps WIB wall time and closes exactly at 15 minutes after start', () => {
    const before = buildCoachingSlots(
      schedule,
      new Date('2026-11-01T13:14:59+07:00'),
    )
    expect(before[0].startAt.toISOString()).toBe('2026-11-01T13:00:00.000Z')
    expect(
      buildCoachingSlots(schedule, new Date('2026-11-01T13:15:00+07:00')),
    ).toEqual([])
  })
  it('supports the last hour of a day without shifting its date', () => {
    const [slot] = buildCoachingSlots(
      { ...schedule, startHour: 23, endHour: 24 },
      new Date('2026-11-01T00:00:00+07:00'),
    )
    expect(slot.startAt.toISOString()).toBe('2026-11-01T23:00:00.000Z')
    expect(slot.endAt.toISOString()).toBe('2026-11-02T00:00:00.000Z')
    expect(
      buildCoachingSlots({ ...schedule, days: [1] }, new Date('2026-10-01')),
    ).toEqual([])
  })
  it('matches service sports and keeps legacy ballboys tennis-only', () => {
    expect(() => assertCoachingSport('BALLBOY', null, 'PADEL')).toThrow(
      'sesuai',
    )
    expect(() => assertCoachingSport('COACH', 'PADEL', 'TENNIS')).toThrow(
      'sesuai',
    )
    expect(() =>
      assertCoachingSport('COACH', 'PADEL_TENNIS', 'TENNIS'),
    ).not.toThrow()
    expect(() => assertCoachingSport('BALLBOY', null, 'TENNIS')).not.toThrow()
  })
})

it('builds repeating services only at matching court times and extends without a date range', async () => {
  const { buildRollingCoachingSlots, rollingCoachingScheduleSchema } =
    await import('./coaching-policy')
  const config = rollingCoachingScheduleSchema.parse({
    followCourtWindow: true,
    days: [1],
    startHour: 13,
    endHour: 15,
    price: 200000,
  })
  const slot = (day: string, hour: number) => ({
    startAt: new Date(`${day}T${hour}:00:00Z`),
    endAt: new Date(`${day}T${hour + 1}:00:00Z`),
  })
  const monday = slot('2026-11-02', 13)
  const nextMonday = slot('2026-11-09', 13)
  const courts = [
    monday,
    monday,
    slot('2026-11-03', 13),
    slot('2026-11-02', 15),
  ]
  const now = new Date('2026-11-01T00:00:00+07:00')
  expect(buildRollingCoachingSlots(config, courts, now)).toEqual([
    { ...monday, price: 200000 },
  ])
  expect(
    buildRollingCoachingSlots(config, [...courts, nextMonday], now),
  ).toEqual([
    { ...monday, price: 200000 },
    { ...nextMonday, price: 200000 },
  ])
  expect(
    rollingCoachingScheduleSchema.safeParse({ ...config, endHour: 12 }).success,
  ).toBe(false)
})

it('supports padel and dual-sport ballboys while rejecting the other sport', () => {
  expect(() => assertCoachingSport('BALLBOY', 'PADEL', 'PADEL')).not.toThrow()
  expect(() => assertCoachingSport('BALLBOY', 'TENNIS', 'PADEL')).toThrow(
    'sesuai',
  )
  expect(() => assertCoachingSport('BALLBOY', 'PADEL', 'TENNIS')).toThrow(
    'sesuai',
  )
  expect(() =>
    assertCoachingSport('BALLBOY', 'PADEL_TENNIS', 'TENNIS'),
  ).not.toThrow()
  expect(() =>
    assertCoachingSport('BALLBOY', 'PADEL_TENNIS', 'PADEL'),
  ).not.toThrow()
})
