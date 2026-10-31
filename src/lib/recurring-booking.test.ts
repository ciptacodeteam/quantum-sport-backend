import { expect, it } from 'vitest'
import {
  dateOnly,
  dateOnlyKey,
  matchingDates,
  recurringBookingInputSchema,
} from './recurring-booking'
import { membershipTransactionStatusWhere } from './membership-transaction-filter'
it('supports rolling without an end date and validates month durations', () => {
  const input = {
    mode: 'ROLLING',
    weekdays: [2],
    startDate: '2026-10-29',
    previewThrough: '2027-01-29',
    sourceSlotIds: ['slot'],
  }
  expect(recurringBookingInputSchema.safeParse(input).success).toBe(true)
  expect(
    recurringBookingInputSchema.safeParse({ ...input, mode: 'MONTHS' }).success,
  ).toBe(false)
  expect(
    recurringBookingInputSchema.safeParse({
      ...input,
      mode: 'MONTHS',
      months: 6,
    }).success,
  ).toBe(true)
})
it('keeps SQL dates stable and includes the last matching weekday', () => {
  expect(dateOnlyKey(dateOnly('2026-10-29'))).toBe('2026-10-29')
  expect(matchingDates('2026-12-29', '2027-01-05', [2, 4])).toEqual([
    '2026-12-29',
    '2026-12-31',
    '2027-01-05',
  ])
})
it('negative membership filter includes expired memberships and is usable by export', () => {
  expect(membershipTransactionStatusWhere('Saldo minus')).toEqual({
    remainingSessions: { lt: 0 },
  })
})
it('supports a fixed date range and rejects reversed or excessive periods', () => {
  const input = {
    mode: 'DATES',
    weekdays: [6],
    startDate: '2026-10-31',
    endDate: '2027-04-30',
    previewThrough: '2027-04-30',
    sourceSlotIds: ['slot'],
  }
  expect(recurringBookingInputSchema.safeParse(input).success).toBe(true)
  expect(
    recurringBookingInputSchema.safeParse({ ...input, endDate: '2026-10-30' })
      .success,
  ).toBe(false)
  expect(
    recurringBookingInputSchema.safeParse({ ...input, endDate: '2027-11-01' })
      .success,
  ).toBe(false)
})
