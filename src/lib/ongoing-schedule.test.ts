import { describe, expect, it } from 'vitest'
import { getOngoingSchedule } from './ongoing-schedule'

const date = (hour: number) =>
  new Date(`2026-10-27T${String(hour).padStart(2, '0')}:00:00Z`)
const slots = [
  { startAt: date(8), endAt: date(9) },
  { startAt: date(9), endAt: date(11) },
]

describe('ongoing booking schedule', () => {
  it('keeps a multi-slot booking ongoing after the first slot ends', () => {
    expect(getOngoingSchedule(slots, date(10))).toEqual({
      startAt: date(8),
      endAt: date(11),
      status: 'ongoing',
    })
  })
  it('excludes finished bookings and bookings without slots', () => {
    expect(getOngoingSchedule(slots, date(11))).toBeNull()
    expect(getOngoingSchedule([], date(8))).toBeNull()
  })
  it('returns the full upcoming range regardless of slot order', () => {
    expect(getOngoingSchedule([...slots].reverse(), date(7))).toEqual({
      startAt: date(8),
      endAt: date(11),
      status: 'upcoming',
    })
  })
})
