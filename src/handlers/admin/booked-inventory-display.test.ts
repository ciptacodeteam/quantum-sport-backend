import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  inventories: vi.fn(),
  coaches: vi.fn(),
  ballboys: vi.fn(),
  detail: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    bookingInventory: { findMany: mocks.inventories, findUnique: mocks.detail },
    bookingCoach: { findMany: mocks.coaches },
    bookingBallboy: { findMany: mocks.ballboys },
  },
}))
import {
  getAllBookedInventoriesHandler,
  getBookedInventoryDetailHandler,
} from './booked-inventory.handler'
const range = (hour: number) => ({
  startAt: new Date(`2040-01-05T0${hour}:00:00Z`),
  endAt: new Date(`2040-01-05T0${hour + 1}:00:00Z`),
})
const court = { id: 'court', name: 'Padel 1', sport: 'PADEL' }
const booking = {
  id: 'booking',
  status: 'CONFIRMED',
  totalPrice: 300000,
  user: { id: 'user', name: 'Demo' },
  invoice: null,
  details: [2, 3].map((hour) => ({ court, slot: range(hour) })),
  coaches: [],
  ballboys: [],
  createdAt: new Date(),
}
const item = {
  id: 'item',
  inventory: { id: 'racket', name: 'Raket', description: null },
  slot: { ...range(3), courtId: 'court', court },
  quantity: 2,
  price: 50000,
  booking,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const context = (value: unknown) => ({
  req: { valid: () => value },
  var: { logger: { fatal: vi.fn() } },
  json: (body: any) => body,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.inventories.mockResolvedValue([item])
  mocks.coaches.mockResolvedValue([])
  mocks.ballboys.mockResolvedValue([])
  mocks.detail.mockResolvedValue(item)
})
it('returns each equipment record with its own slot, not every session in the booking', async () => {
  const result = await (getAllBookedInventoriesHandler[1] as any)(context({}))
  expect(result.data[0].slot).toMatchObject(range(3))
  expect(result.data[0].booking.courtSlots).toHaveLength(1)
  expect(result.data[0].booking.courtSlots[0]).toMatchObject(range(3))
})
it('restricts coach context to the coach session', async () => {
  mocks.inventories.mockResolvedValue([])
  mocks.coaches.mockResolvedValue([
    {
      id: 'coach',
      slot: { ...range(2), staff: { id: 'staff', name: 'Pelatih' } },
      price: 200000,
      bookingCoachType: { name: 'Privat' },
      booking,
    },
  ])
  const result = await (getAllBookedInventoriesHandler[1] as any)(context({}))
  expect(result.data[0].booking.courtSlots).toHaveLength(1)
  expect(result.data[0].booking.courtSlots[0]).toMatchObject(range(2))
})
it('provides the matching slot and public customer fields for the detail dialog', async () => {
  const result = await (getBookedInventoryDetailHandler[1] as any)(
    context({ id: 'item' }),
  )
  expect(result.data.slot).toMatchObject(range(3))
  expect(result.data.booking.customer.name).toBe('Demo')
  expect(result.data.booking.courtSlots).toHaveLength(1)
  expect(
    mocks.detail.mock.calls[0][0].include.booking.include.user.select,
  ).not.toHaveProperty('password')
})
