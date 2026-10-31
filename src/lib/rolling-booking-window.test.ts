import { describe, expect, it } from 'vitest'
import dayjs from '@/lib/club-time'
import {
  bookingWindowEnd,
  buildRollingCourtSlots,
  rollingBookingWindowWhere,
  rollingCourtPricingSchema,
} from './rolling-booking-window'

const config = rollingCourtPricingSchema.parse({
  courtId: 'court',
  months: 1,
  days: [1, 2, 3, 4, 5, 6, 7],
  happyHourPrice: 100,
  peakHourPrice: 200,
})

describe('rolling booking window', () => {
  it.each([
    ['2026-01-31T03:00:00Z', 1, '2026-02-28'],
    ['2028-01-31T03:00:00Z', 1, '2028-02-29'],
    ['2026-12-31T03:00:00Z', 2, '2027-02-28'],
    ['2026-10-29T16:59:59Z', 1, '2026-11-29'],
    ['2026-10-29T17:00:00Z', 1, '2026-11-30'],
  ])(
    'uses calendar months and Jakarta midnight (%s)',
    (now, months, expected) => {
      expect(
        dayjs(bookingWindowEnd(months, new Date(now))).format(
          'YYYY-MM-DD HH:mm:ss.SSS',
        ),
      ).toBe(`${expected} 23:59:59.999`)
    },
  )
  it('includes the final day, closes chosen hours, excludes started slots and ends 23:00 at midnight', () => {
    const now = new Date('2026-10-29T07:30:00Z')
    const slots = buildRollingCourtSlots(
      { ...config, closedHours: [15] },
      'branch-b',
      now,
      now,
    )
    expect(
      slots.every((s) => s.startAt > now && s.branchId === 'branch-b'),
    ).toBe(true)
    expect(slots.some((s) => dayjs(s.startAt).hour() === 15)).toBe(false)
    expect(dayjs(slots[0].startAt).format('HH:mm')).toBe('16:00')
    const last = slots.at(-1)!
    expect(dayjs(last.startAt).format('YYYY-MM-DD HH:mm')).toBe(
      '2026-11-29 23:00',
    )
    expect(dayjs(last.endAt).format('YYYY-MM-DD HH:mm')).toBe(
      '2026-11-30 00:00',
    )
    expect(last.price).toBe(200)
  })
  it('uses Monday=1 and Sunday=7 consistently', () => {
    const now = new Date('2026-10-29T00:00:00Z')
    const slots = buildRollingCourtSlots(
      { ...config, days: [7] },
      'a',
      now,
      now,
    )
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((s) => dayjs(s.startAt).day() === 0)).toBe(true)
  })
  it.each([
    { months: 0 },
    { months: 13 },
    { months: 1.5 },
    { days: [] },
    { days: [0] },
    { days: [8] },
    { closedHours: [24] },
    { happyHourPrice: 1.5 },
    { peakHourPrice: 2147483648 },
    { happyHourDiscountPrice: 101 },
    { peakHourDiscountPrice: 201 },
  ])('rejects invalid admin input %j', (patch) => {
    expect(
      rollingCourtPricingSchema.safeParse({ ...config, ...patch }).success,
    ).toBe(false)
  })
  it('builds a server-side restriction for each duration, while supporting legacy courts', () => {
    const where = rollingBookingWindowWhere(new Date('2026-10-29T00:00:00Z'))
    expect(where.scheduleClosed).toBe(false)
    expect(where.OR).toHaveLength(13)
    expect(where.OR?.[0]).toEqual({
      court: { is: { bookingWindowMonths: null } },
    })
    expect(where.OR?.[1]).toMatchObject({
      startAt: { lte: bookingWindowEnd(1, new Date('2026-10-29T00:00:00Z')) },
    })
  })
  it('uses the latest matching price rule from its effective date, leaving other hours and dates unchanged', () => {
    const now = new Date('2026-10-30T02:00:00Z')
    const filter = {
      kind: 'pricing' as const,
      fromDate: '2026-11-01',
      days: [7],
      startHour: 17,
      endHour: 19,
      price: 500,
      discountPrice: 400,
    }
    const slots = buildRollingCourtSlots(
      { ...config, bulkRules: [filter, { ...filter, price: 600 }] },
      'branch',
      now,
      now,
    )
    const at = (time: string) =>
      slots.find(
        (slot) => dayjs(slot.startAt).format('YYYY-MM-DD HH:mm') === time,
      )!
    expect(at('2026-10-30 17:00').price).toBe(200)
    expect(at('2026-11-01 17:00')).toMatchObject({
      price: 600,
      discountPrice: 400,
    })
    expect(at('2026-11-01 19:00').price).toBe(200)
    expect(at('2026-11-02 17:00').price).toBe(200)
  })
})
