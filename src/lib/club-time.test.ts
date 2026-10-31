import { expect, it } from 'vitest'
import clubTime, {
  clubWallDayEnd,
  clubWallDayStart,
  clubWallNextDayStart,
  formatClubWallClock,
  toClubWallDate,
} from './club-time'
import { isSlotAllowedForMembershipType } from './membership-hours'

it('keeps true UTC instants in Jakarta for createdAt-style values', () => {
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

it('uses Jakarta midnight for real-instant date filters', () => {
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

it('formats wall-stored slot timestamps without a +7 shift', () => {
  expect(formatClubWallClock(new Date('2026-10-23T09:00:00Z'))).toBe(
    '2026-10-23 09:00:00',
  )
  expect(formatClubWallClock('2026-10-23T19:00:00.000Z', 'HH:mm')).toBe('19:00')
  expect(formatClubWallClock('2026-10-23 19:00:00', 'HH:mm')).toBe('19:00')
})

it('builds wall day bounds for Prisma slot filters', () => {
  expect(clubWallDayStart('2026-10-23').toISOString()).toBe(
    '2026-10-23T00:00:00.000Z',
  )
  expect(clubWallDayEnd('2026-10-23T23:59:59').toISOString()).toBe(
    '2026-10-23T23:59:59.999Z',
  )
  expect(clubWallNextDayStart('2026-10-23').toISOString()).toBe(
    '2026-10-24T00:00:00.000Z',
  )
  expect(toClubWallDate('2026-10-23 19:00:00').toISOString()).toBe(
    '2026-10-23T19:00:00.000Z',
  )
})

it('checks membership time bands against wall-stored slot hours', () => {
  expect(
    isSlotAllowedForMembershipType(
      'HAPPY_HOUR',
      new Date('2026-10-23T10:00:00Z'),
    ),
  ).toBe(true)
  expect(
    isSlotAllowedForMembershipType(
      'HAPPY_HOUR',
      new Date('2026-10-23T16:00:00Z'),
    ),
  ).toBe(false)
  expect(
    isSlotAllowedForMembershipType(
      'AFTER_HOUR',
      new Date('2026-10-23T16:00:00Z'),
    ),
  ).toBe(true)
})
