import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ bookings: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { bookingBallboy: { findMany: mocks.bookings } },
}))
import { filterAvailableBallboySlots } from './ballboy-availability.service'
const slot = (id: string, staffId = 'ballboy', start = 10, end = 11) => ({
  id,
  staffId,
  startAt: new Date(Date.UTC(2030, 0, 1, start)),
  endAt: new Date(Date.UTC(2030, 0, 1, end)),
})
beforeEach(() => vi.clearAllMocks())
it('blocks overlapping schedule rows for the same person, keeping adjacent slots and other people available', async () => {
  mocks.bookings.mockResolvedValue([
    { slot: slot('booked', 'ballboy', 10, 12) },
  ])
  const candidates = [
    slot('overlap'),
    slot('adjacent', 'ballboy', 12, 13),
    slot('different', 'other'),
  ]
  expect(
    (await filterAvailableBallboySlots(candidates)).map((s) => s.id),
  ).toEqual(['adjacent', 'different'])
  expect(mocks.bookings).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        status: { not: 'CANCELLED' },
        booking: { status: { not: 'CANCELLED' } },
      }),
    }),
  )
})
it('does not query bookings for an empty schedule', async () => {
  expect(await filterAvailableBallboySlots([])).toEqual([])
  expect(mocks.bookings).not.toHaveBeenCalled()
})
