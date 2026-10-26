import { expect, it } from 'vitest'
import clubTime from './club-time'
import { isSlotAllowedForMembershipType } from './membership-hours'

it('keeps the last evening slot at 23:00 Jakarta even on a UTC server', () => {
  expect(
    clubTime(new Date('2026-10-23T16:00:00Z')).format('YYYY-MM-DD HH:mm'),
  ).toBe('2026-10-23 23:00')
  expect(clubTime('2026-10-23 23:00:00').toISOString()).toBe(
    '2026-10-23T16:00:00.000Z',
  )
  expect(clubTime('2026-10-23T23:00:00+07:00').toISOString()).toBe(
    '2026-10-23T16:00:00.000Z',
  )
})
it('uses Jakarta midnight for date filters and handles the next day at closing', () => {
  expect(clubTime('2026-10-23').startOf('day').toISOString()).toBe(
    '2026-10-22T17:00:00.000Z',
  )
  expect(clubTime('2026-10-23').endOf('day').toISOString()).toBe(
    '2026-10-23T16:59:59.999Z',
  )
  expect(clubTime('2026-10-23').hour(24).toISOString()).toBe(
    '2026-10-23T17:00:00.000Z',
  )
})
it('checks membership time bands in club time', () => {
  expect(
    isSlotAllowedForMembershipType(
      'HAPPY_HOUR',
      new Date('2026-10-23T03:00:00Z'),
    ),
  ).toBe(true)
  expect(
    isSlotAllowedForMembershipType(
      'HAPPY_HOUR',
      new Date('2026-10-23T10:00:00Z'),
    ),
  ).toBe(false)
  expect(
    isSlotAllowedForMembershipType(
      'AFTER_HOUR',
      new Date('2026-10-23T10:00:00Z'),
    ),
  ).toBe(true)
})
