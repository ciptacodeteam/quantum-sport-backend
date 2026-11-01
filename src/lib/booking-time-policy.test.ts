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
  const start = new Date('2026-10-28T15:00:00Z') // Prisma wall components: 15:00 WIB
  expect(start > courtBookingCutoff(new Date(now))).toBe(allowed)
})

it('handles grace periods across Jakarta midnight and keeps payment expiry as a true instant', () => {
  const now = new Date('2026-11-01T00:10:00+07:00')
  expect(courtBookingCutoff(now).toISOString()).toBe('2026-10-31T23:55:00.000Z')
  expect(paymentDeadline(now).toISOString()).toBe('2026-10-31T17:20:00.000Z')
})
