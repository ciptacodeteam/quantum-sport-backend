import { expect, it } from 'vitest'
import { priceCoachSessions } from './coach-session-pricing'
const slot = (hour: number, staffId = 'coach-a') => ({
  id: `${staffId}-${hour}`,
  staffId,
  startAt: new Date(Date.UTC(2040, 0, 1, hour)),
  endAt: new Date(Date.UTC(2040, 0, 1, hour + 1)),
  price: 200000,
  additionalHourPrice: 100000 as number | null,
})
it.each([1, 2, 3, 4, 5])(
  'charges 200k first plus 100k for each extra hour (%i hours)',
  (hours) => {
    const slots = Array.from({ length: hours }, (_, i) =>
      slot(10 + i),
    ).reverse()
    const prices = priceCoachSessions(slots)
    expect([...prices.values()].reduce((a, b) => a + b, 0)).toBe(
      200000 + (hours - 1) * 100000,
    )
    expect(prices.get('coach-a-10')).toBe(200000)
  },
)
it('starts over after gaps, different coaches, and separate booking calculations', () => {
  const prices = priceCoachSessions([
    slot(10),
    slot(11, 'coach-b'),
    slot(12),
    slot(13),
  ])
  expect([...prices.values()]).toEqual([200000, 200000, 200000, 100000])
  expect([...priceCoachSessions([slot(14)]).values()]).toEqual([200000])
})
it('continues across midnight and respects null, zero, and per-slot pricing', () => {
  expect([...priceCoachSessions([slot(23), slot(24)]).values()]).toEqual([
    200000, 100000,
  ])
  expect([
    ...priceCoachSessions([
      slot(10),
      { ...slot(11), additionalHourPrice: null, price: 250000 },
    ]).values(),
  ]).toEqual([200000, 250000])
  expect([
    ...priceCoachSessions([
      slot(10),
      { ...slot(11), additionalHourPrice: 0 },
    ]).values(),
  ]).toEqual([200000, 0])
})
