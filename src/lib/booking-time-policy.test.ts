import { expect, it } from 'vitest'
import { courtBookingCutoff, paymentDeadline } from './booking-time-policy'

it('sets payment expiry exactly ten minutes from issue time', () => {
  expect(paymentDeadline(new Date('2026-10-28T15:00:00+07:00'))).toEqual(
    new Date('2026-10-28T15:10:00+07:00'),
  )
})

it.each([
  ['2026-10-28T14:59:59+07:00', true],
  ['2026-10-28T15:00:00+07:00', true],
  ['2026-10-28T15:14:59.999+07:00', true],
  ['2026-10-28T15:15:00+07:00', false],
  ['2026-10-28T15:16:00+07:00', false],
])('enforces the 15-minute court booking boundary at %s', (now, allowed) => {
  const start = new Date('2026-10-28T15:00:00+07:00')
  expect(start > courtBookingCutoff(new Date(now))).toBe(allowed)
})
