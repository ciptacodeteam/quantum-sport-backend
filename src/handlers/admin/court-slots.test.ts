import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ slots: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: { slot: { findMany: mocks.slots } } }))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/services/upload.service', () => ({
  getFileUrl: async (value: string) => value,
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
}))
vi.mock('@/services/costing.service', () => ({
  bulkUpdateCourtSlotPricing: vi.fn(),
  updateSlotPricing: vi.fn(),
}))
import { getAvailableCourtSlotsHandler } from './court.handler'

beforeEach(() => vi.clearAllMocks())
const slot = {
  id: 'slot',
  price: 200000,
  discountPrice: 0,
  court: { id: 'court', name: 'Court 1', image: null },
  isAvailable: true,
  startAt: new Date('2026-10-27T12:00:00Z'),
  endAt: new Date('2026-10-27T13:00:00Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
  bookingDetails: [],
}
async function request(includeUnavailable?: string) {
  const context = {
    req: { valid: () => ({ includeUnavailable }) },
    var: { logger: { fatal: vi.fn() } },
    json: (body: any) => body,
  }
  return (getAvailableCourtSlotsHandler.at(-1) as any)(context, vi.fn())
}
it('includes booked hours in the price schedule while preserving their unavailable status', async () => {
  mocks.slots.mockResolvedValue([
    slot,
    {
      ...slot,
      id: 'booked',
      bookingDetails: [{ booking: { status: 'CONFIRMED' } }],
    },
    { ...slot, id: 'hold', bookingDetails: [{ booking: { status: 'HOLD' } }] },
    { ...slot, id: 'closed', isAvailable: false },
  ])
  const response = await request('true')
  expect(mocks.slots.mock.calls[0][0].where).not.toHaveProperty(
    'bookingDetails',
  )
  expect(mocks.slots.mock.calls[0][0].where).not.toHaveProperty('isAvailable')
  expect(
    response.data.map(({ availabilityStatus, isAvailable, price }: any) => ({
      availabilityStatus,
      isAvailable,
      price,
    })),
  ).toEqual([
    { availabilityStatus: 'AVAILABLE', isAvailable: true, price: 200000 },
    { availabilityStatus: 'BOOKED', isAvailable: false, price: 200000 },
    { availabilityStatus: 'ON_HOLD', isAvailable: false, price: 200000 },
    { availabilityStatus: 'UNAVAILABLE', isAvailable: false, price: 200000 },
  ])
  expect(response.data[1]).not.toHaveProperty('bookingDetails')
})
it('preserves the available-only default for other callers', async () => {
  mocks.slots.mockResolvedValue([slot])
  await request()
  expect(mocks.slots.mock.calls[0][0].where).toMatchObject({
    isAvailable: true,
    bookingDetails: { none: { booking: { status: { not: 'CANCELLED' } } } },
  })
})
