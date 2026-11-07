import { expect, it, vi } from 'vitest'
import {
  linkedCoachSessionPrice,
  linkedCoachSessionPrices,
} from './coach-session-pricing.service'
const slot = {
  price: 200000,
  additionalHourPrice: 100000,
  staffId: 'coach',
  startAt: new Date('2040-01-02T11:00:00Z'),
  endAt: new Date('2040-01-02T12:00:00Z'),
}
it('only grants an extension rate for a confirmed adjacent hour in the same root booking', async () => {
  const findFirst = vi.fn().mockResolvedValue({ id: 'previous' })
  const tx = { bookingCoach: { findFirst } } as any
  expect(await linkedCoachSessionPrice(tx, slot, 'root-booking')).toBe(100000)
  expect(findFirst).toHaveBeenCalledWith({
    where: {
      status: 'CONFIRMED',
      booking: { status: 'CONFIRMED' },
      OR: [
        { bookingId: 'root-booking' },
        { booking: { serviceForBookingId: 'root-booking' } },
      ],
      slot: { staffId: 'coach', endAt: slot.startAt },
    },
    select: { id: true },
  })
  findFirst.mockResolvedValue(null)
  expect(await linkedCoachSessionPrice(tx, slot, 'root-booking')).toBe(200000)
})
it('preserves flat pricing without a configured extension rate', async () => {
  const findFirst = vi.fn()
  expect(
    await linkedCoachSessionPrice(
      { bookingCoach: { findFirst } } as any,
      { ...slot, additionalHourPrice: null },
      'root',
    ),
  ).toBe(200000)
  expect(findFirst).not.toHaveBeenCalled()
})

it('batches confirmed adjacent-hour prices and preserves zero-priced extensions', async () => {
  const findMany = vi
    .fn()
    .mockResolvedValue([{ slot: { staffId: 'coach', endAt: slot.startAt } }])
  const prices = await linkedCoachSessionPrices(
    { bookingCoach: { findMany } } as never,
    [
      { ...slot, id: 'a', additionalHourPrice: 0 },
      { ...slot, id: 'b', staffId: 'other' },
      { ...slot, id: 'c', additionalHourPrice: null },
    ],
    'root',
  )
  expect(Object.fromEntries(prices)).toEqual({ a: 0, b: 200000, c: 200000 })
  expect(findMany).toHaveBeenCalledTimes(1)
  expect(findMany.mock.calls[0][0].where).toMatchObject({
    status: 'CONFIRMED',
    booking: { status: 'CONFIRMED' },
    OR: [{ bookingId: 'root' }, { booking: { serviceForBookingId: 'root' } }],
  })
})
it('does not query adjacent bookings when none of the offers has extension pricing', async () => {
  const findMany = vi.fn()
  const prices = await linkedCoachSessionPrices(
    { bookingCoach: { findMany } } as never,
    [{ ...slot, id: 'a', additionalHourPrice: null }],
    'root',
  )
  expect(prices.get('a')).toBe(200000)
  expect(findMany).not.toHaveBeenCalled()
})
