vi.mock('@/services/rolling-court-schedule.service', () => ({
  ensureRollingCourtSchedules: vi.fn(),
}))
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  slots: vi.fn(),
  image: vi.fn(async (value: string) => value),
}))
vi.mock('@/lib/prisma', () => ({ db: { slot: { findMany: mocks.slots } } }))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/services/upload.service', () => ({
  getFileUrl: mocks.image,
}))
import { getAvailableCourtSlotsHandler } from './court.handler'
import { ensureRollingCourtSchedules } from '@/services/rolling-court-schedule.service'
it('returns evening wall slots through 23:00 and preserves booked/unavailable states', async () => {
  const slot = {
    id: 'evening',
    price: 200000,
    discountPrice: 0,
    court: { id: 'court', name: 'Court 1', image: 'courts/court.webp' },
    isAvailable: true,
    startAt: new Date('2026-10-23T23:00:00Z'),
    endAt: new Date('2026-10-24T00:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    bookingDetails: [],
  }
  mocks.slots.mockResolvedValue([
    slot,
    {
      ...slot,
      id: 'booked',
      bookingDetails: [{ booking: { status: 'CONFIRMED' } }],
    },
    { ...slot, id: 'closed', isAvailable: false },
  ])
  const context = {
    req: {
      valid: () => ({
        startAt: '2026-10-23 00:00:00',
        endAt: '2026-10-23 23:59:59',
        includeUnavailable: 'true',
      }),
    },
    var: { logger: { fatal: vi.fn() } },
    json: (body: unknown) => body,
  }
  const response = await (getAvailableCourtSlotsHandler.at(-1) as any)(
    context,
    vi.fn(),
  )
  expect(ensureRollingCourtSchedules).toHaveBeenCalledWith(
    undefined,
    expect.any(Date),
    { includeServices: false },
  )
  expect(mocks.slots.mock.calls[0][0].include.court).toEqual({
    select: {
      id: true,
      name: true,
      image: true,
      description: true,
      sport: true,
    },
  })
  expect(mocks.image).toHaveBeenCalledTimes(1)
  const bounds = mocks.slots.mock.calls[0][0].where.AND
  expect(bounds[0].startAt.lt.toISOString()).toBe('2026-10-23T23:59:59.999Z')
  expect(bounds[1].endAt.gt.toISOString()).toBe('2026-10-23T00:00:00.000Z')
  expect(response.data[0]).toMatchObject({
    startAt: '2026-10-23 23:00:00',
    endAt: '2026-10-24 00:00:00',
    isAvailable: true,
  })
  expect(response.data[1]).toMatchObject({
    availabilityStatus: 'BOOKED',
    isAvailable: false,
  })
  expect(response.data[2]).toMatchObject({
    availabilityStatus: 'UNAVAILABLE',
    isAvailable: false,
  })
})
