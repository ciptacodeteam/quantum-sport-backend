import { describe, expect, it } from 'vitest'
import { getOngoingSchedule } from './ongoing-schedule'

const date = (hour: number) =>
  new Date(`2026-10-27T${String(hour).padStart(2, '0')}:00:00Z`)
// Actual instants corresponding to the requested Jakarta hour.
const nowAt = (hour: number) =>
  new Date(`2026-10-27T${String(hour).padStart(2, '0')}:00:00+07:00`)
const slots = [
  { startAt: date(8), endAt: date(9) },
  { startAt: date(9), endAt: date(11) },
]

describe('ongoing booking schedule', () => {
  it('keeps a multi-slot booking ongoing after the first slot ends', () => {
    expect(getOngoingSchedule(slots, nowAt(10))).toEqual({
      startAt: date(8),
      endAt: date(11),
      status: 'ongoing',
    })
  })
  it('excludes finished bookings and bookings without slots', () => {
    expect(getOngoingSchedule(slots, nowAt(11))).toBeNull()
    expect(getOngoingSchedule([], nowAt(8))).toBeNull()
  })
  it('returns the full upcoming range regardless of slot order', () => {
    expect(getOngoingSchedule([...slots].reverse(), nowAt(7))).toEqual({
      startAt: date(8),
      endAt: date(11),
      status: 'upcoming',
    })
  })
})

it('starts exactly at the Jakarta start boundary', () => {
  expect(getOngoingSchedule(slots, nowAt(8))?.status).toBe('ongoing')
})

it('uses the Jakarta date when UTC is still on the previous day', () => {
  const overnight = [
    {
      startAt: new Date('2026-11-12T00:00:00Z'),
      endAt: new Date('2026-11-12T01:00:00Z'),
    },
  ]
  expect(
    getOngoingSchedule(overnight, new Date('2026-11-11T17:30:00Z'))?.status,
  ).toBe('ongoing')
  expect(
    getOngoingSchedule(overnight, new Date('2026-11-11T18:00:00Z')),
  ).toBeNull()
})
