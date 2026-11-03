import { expect, it } from 'vitest'
import { z } from 'zod'
import {
  bookingDateRangeFields,
  validBookingDateRange,
  bookingDateRangeError,
  playingDateRange,
  purchaseDateWhere,
} from './booking-date-filter'
const schema = z
  .object(bookingDateRangeFields)
  .refine(validBookingDateRange, bookingDateRangeError)
it('includes the complete final playing day without shifting wall-clock slots', () => {
  expect(
    playingDateRange({ dateFrom: '2026-11-03', dateTo: '2026-11-03' }),
  ).toEqual({
    gte: new Date('2026-11-03T00:00:00Z'),
    lt: new Date('2026-11-04T00:00:00Z'),
  })
})
it('uses WIB midnight bounds for actual package purchase timestamps', () => {
  expect(
    purchaseDateWhere({ dateFrom: '2026-11-03', dateTo: '2026-11-03' }),
  ).toEqual({
    createdAt: {
      gte: new Date('2026-11-02T17:00:00Z'),
      lt: new Date('2026-11-03T17:00:00Z'),
    },
  })
})
it('supports either bound and leaves unfiltered requests unrestricted', () => {
  expect(playingDateRange({ dateFrom: '2026-11-03' })).toEqual({
    gte: new Date('2026-11-03T00:00:00Z'),
  })
  expect(playingDateRange({ dateTo: '2026-11-03' })).toEqual({
    lt: new Date('2026-11-04T00:00:00Z'),
  })
  expect(playingDateRange({})).toBeUndefined()
  expect(purchaseDateWhere({})).toEqual({})
})
it.each([
  { dateFrom: '2026-02-30' },
  { dateTo: 'not-a-date' },
  { dateFrom: '2026-11-04', dateTo: '2026-11-03' },
])('rejects an invalid calendar range %j', (range) => {
  expect(schema.safeParse(range).success).toBe(false)
})
