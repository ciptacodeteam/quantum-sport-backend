import { expect, it, vi } from 'vitest'
import { linkedCoachSessionPrice } from './coach-session-pricing.service'
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
