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
  it('restricts ballboys to tennis and matches coach sports', () => {
    expect(() => assertCoachingSport('BALLBOY', null, 'PADEL')).toThrow(
      'tennis',
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
