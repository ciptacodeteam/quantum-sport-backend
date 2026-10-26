import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ slots: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: { slot: { findMany: mocks.slots } } }))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/services/upload.service', () => ({
  getFileUrl: async (value: string) => value,
}))
import { getAvailableCourtSlotsHandler } from './court.handler'
it('returns evening slots through 23:00 and preserves booked/unavailable states', async () => {
  const slot = {
    id: 'evening',
    price: 200000,
    discountPrice: 0,
    court: { id: 'court', name: 'Court 1', image: null },
    isAvailable: true,
    startAt: new Date('2026-10-23T16:00:00Z'),
    endAt: new Date('2026-10-23T17:00:00Z'),
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
  const bounds = mocks.slots.mock.calls[0][0].where.AND
  expect(bounds[0].startAt.lt.toISOString()).toBe('2026-10-23T16:59:59.999Z')
  expect(bounds[1].endAt.gt.toISOString()).toBe('2026-10-22T17:00:00.000Z')
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
