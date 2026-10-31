import { expect, it } from 'vitest'
import { courtBookingRange } from './court-booking-range'
const now = new Date('2026-10-31T03:00:00Z')
it('clamps a one-month rolling window at the inclusive Jakarta calendar-month boundary', () => {
  expect(
    courtBookingRange([{ bookingWindowMonths: 1, slot: [] }], now),
  ).toEqual({ startDate: '2026-10-31', endDate: '2026-11-30', months: 1 })
})
it('does not silently extend configured windows by three months for unpublished manual courts', () => {
  expect(
    courtBookingRange(
      [
        { bookingWindowMonths: 1, slot: [] },
        { bookingWindowMonths: null, slot: [] },
      ],
      now,
    ).endDate,
  ).toBe('2026-11-30')
})
it('bounds manual schedules by their published final slot and uses the longest actual court window', () => {
  expect(
    courtBookingRange(
      [
        {
          bookingWindowMonths: null,
          slot: [{ startAt: new Date('2026-11-10T16:00:00Z') }],
        },
        { bookingWindowMonths: 1, slot: [] },
      ],
      now,
    ).endDate,
  ).toBe('2026-11-30')
  expect(
    courtBookingRange(
      [
        {
          bookingWindowMonths: null,
          slot: [{ startAt: new Date('2026-11-10T16:00:00Z') }],
        },
      ],
      now,
    ).endDate,
  ).toBe('2026-11-10')
})
it('does not invent future capacity when there are no active courts', () => {
  expect(courtBookingRange([], now).endDate).toBe('2026-10-31')
})
