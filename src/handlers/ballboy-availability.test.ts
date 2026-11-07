import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  slots: vi.fn(),
  filter: vi.fn(),
  ensure: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ db: { slot: { findMany: mocks.slots } } }))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/services/ballboy-schedule.service', () => ({
  ensureBallboySchedules: mocks.ensure,
}))
vi.mock('@/services/ballboy-availability.service', () => ({
  filterAvailableBallboySlots: mocks.filter,
}))
import { getAvailableBallboyHandler } from './ballboy.handler'
beforeEach(() => vi.clearAllMocks())
it('returns schedule hours including booked hours in WIB without offering unavailable slots', async () => {
  const row = (hour: number, isAvailable: boolean) => ({
    id: `slot-${hour}`,
    staffId: 'budi',
    staff: { id: 'budi', name: 'Budi' },
    price: 45000,
    startAt: new Date(`2030-01-02T${hour}:00:00Z`),
    endAt: new Date(`2030-01-02T${hour + 1}:00:00Z`),
    isAvailable,
  })
  const available = row(11, true)
  mocks.slots.mockResolvedValue([row(10, false), available, row(11, false)])
  mocks.filter.mockResolvedValue([available])
  const response = await (getAvailableBallboyHandler.at(-1) as any)({
    req: {
      valid: () => ({
        startAt: '2030-01-02T00:00:00',
        endAt: '2030-01-03T00:00:00',
        courtSport: 'TENNIS',
      }),
      path: '/ballboys/availability',
    },
    json: (body: unknown) => body,
  })
  expect(response.hours).toEqual(['10:00', '11:00'])
  expect(response.data).toEqual([
    expect.objectContaining({
      startAt: '2030-01-02 11:00:00',
      endAt: '2030-01-02 12:00:00',
    }),
  ])
  expect(mocks.filter).toHaveBeenCalledWith([available])
  expect(mocks.slots.mock.calls[0][0].where).toMatchObject({
    scheduleClosed: false,
    staff: { adminServiceOnly: false },
  })
})
