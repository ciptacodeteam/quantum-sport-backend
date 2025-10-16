import { describe, it, expect } from 'vitest'
import { toDayNums, getScheduleFromDateRange } from './day'

describe('toDayNums', () => {
  it('returns null for empty or undefined', () => {
    expect(toDayNums(undefined)).toBeNull()
    expect(toDayNums([])).toBeNull()
  })

  it('accepts numeric day tokens', () => {
    const s = toDayNums([0, 1, 6])
    expect(s).toBeInstanceOf(Set)
    expect(Array.from(s!)).toEqual(expect.arrayContaining([0, 1, 6]))
  })

  it('accepts string day tokens (english and indonesian)', () => {
    const s = toDayNums(['Sunday', 'Senin', 'Tue'])
    expect(s).toBeInstanceOf(Set)
    // Sunday -> 0, senin -> 1, Tue -> 2
    expect(Array.from(s!)).toEqual(expect.arrayContaining([0, 1, 2]))
  })

  it('filters out invalid tokens', () => {
    const s = toDayNums(['notaday', 42, -1, 'Mon'] as unknown as Array<any>)
    expect(s).toBeInstanceOf(Set)
    expect(Array.from(s!)).toEqual(expect.arrayContaining([1]))
  })
})

describe('getScheduleFromDateRange', () => {
  it('generates hourly schedule across two days', () => {
    const schedules = getScheduleFromDateRange(
      '2025-01-01',
      '2025-01-02',
      '08:00',
      '10:00',
    )
    // 2 days, 3 time slots each (08:00,09:00,10:00) => 6 entries
    expect(schedules.length).toBe(6)
    expect(schedules[0]).toEqual({ date: '2025-01-01', time: '08:00' })
    expect(schedules[schedules.length - 1]).toEqual({
      date: '2025-01-02',
      time: '10:00',
    })
  })

  it('supports custom interval minutes', () => {
    const schedules = getScheduleFromDateRange(
      '2025-01-01',
      '2025-01-01',
      '08:00',
      '09:00',
      undefined,
      30,
    )
    // 08:00, 08:30, 09:00 => 3 entries
    expect(schedules.length).toBe(3)
    expect(schedules.map((s) => s.time)).toEqual(['08:00', '08:30', '09:00'])
  })

  it('filters by days', () => {
    // 2025-01-01 is a Wednesday, 2025-01-02 is a Thursday
    const schedules = getScheduleFromDateRange(
      '2025-01-01',
      '2025-01-03',
      '08:00',
      '09:00',
      ['Thursday'],
    )
    // only 2025-01-02 (Thursday) should be included => 2 slots (08:00,09:00)
    expect(schedules.every((s) => s.date === '2025-01-02')).toBe(true)
    expect(schedules.length).toBe(2)
  })

  it('throws for invalid dates or reversed range', () => {
    expect(() =>
      getScheduleFromDateRange('invalid', '2025-01-02', '08:00', '09:00'),
    ).toThrow()
    expect(() =>
      getScheduleFromDateRange('2025-01-03', '2025-01-01', '08:00', '09:00'),
    ).toThrow()
  })
})
