import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  occupied: vi.fn(),
  update: vi.fn(),
  coaches: vi.fn(),
  ballboys: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    bookingCoach: { findMany: mocks.coaches },
    bookingBallboy: { findMany: mocks.ballboys },
    $transaction: (fn: any) =>
      fn({
        slot: {
          findFirst: async () => ({ id: 'slot', staffId: 'ballboy' }),
          count: mocks.occupied,
          update: mocks.update,
        },
        staff: {
          findFirst: async () => ({
            id: 'ballboy',
            role: 'BALLBOY',
            branchId: 'cemara',
          }),
        },
        $queryRaw: vi.fn(),
      }),
  },
}))
import { Hono } from 'hono'
import {
  listCoachingBookingsHandler,
  attachCoachingHandler,
  toggleCoachingSlotHandler,
} from './coaching.handler'
const request = (body: Record<string, unknown>) =>
  (toggleCoachingSlotHandler.at(-1) as any)({
    req: {
      valid: (type: string) => (type === 'param' ? { id: 'slot' } : body),
    },
    json: (body: unknown) => body,
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.coaches.mockResolvedValue([])
  mocks.ballboys.mockResolvedValue([])
  mocks.occupied.mockResolvedValue(0)
  mocks.update.mockResolvedValue({
    id: 'slot',
    price: 60000,
    isAvailable: true,
  })
})
it('updates an individual service price without toggling its availability', async () => {
  await request({ price: 60000 })
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: 'slot' },
    data: { price: 60000, isAvailable: undefined },
  })
})
it('protects the price of an occupied slot after acquiring the staff lock', async () => {
  mocks.occupied.mockResolvedValue(1)
  await expect(request({ price: 60000 })).rejects.toThrow('dibooking')
  expect(mocks.update).not.toHaveBeenCalled()
})

const validationApp = new Hono().post(
  '/:id',
  attachCoachingHandler[0] as any,
  attachCoachingHandler[1] as any,
  (c) => c.json({ valid: true }),
)
it.each([
  { slotIds: ['coach'], manualPayment: { method: 'EDC', received: false } },
  { slotIds: ['coach'], manualPayment: { method: 'QRIS_STATIC' } },
  {
    slotIds: ['coach'],
    manualPayment: { method: 'BANK_TRANSFER_MANUAL', received: false },
  },
  { slotId: 'coach', slotIds: ['ballboy'] },
  { slotIds: ['a', 'b', 'c'] },
])(
  'rejects invalid or unconfirmed service payment payloads: %j',
  async (body) => {
    const res = await validationApp.request('/detail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(422)
  },
)
it.each(['EDC', 'QRIS_STATIC', 'BANK_TRANSFER_MANUAL'])(
  'accepts a combined service selection with an explicitly received %s payment',
  async (method) => {
    const res = await validationApp.request('/detail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slotIds: ['coach', 'ballboy'],
        manualPayment: { method, received: true },
      }),
    })
    expect(res.status).toBe(200)
  },
)

it.each(['COACH', 'BALLBOY'])(
  'limits %s rows by playing date before the 500-row cap',
  async (kind) => {
    await (listCoachingBookingsHandler.at(-1) as any)({
      req: {
        valid: () => ({ kind, dateFrom: '2026-11-03', dateTo: '2026-11-03' }),
      },
      json: (value: unknown) => value,
    })
    const query = (kind === 'COACH' ? mocks.coaches : mocks.ballboys).mock
      .calls[0][0]
    expect(query.where).toEqual({
      slot: {
        startAt: {
          gte: new Date('2026-11-03T00:00:00Z'),
          lt: new Date('2026-11-04T00:00:00Z'),
        },
      },
    })
    expect(query.take).toBe(500)
  },
)
it('rejects invalid coach/ballboy date ranges before querying bookings', async () => {
  const a = new Hono().get(
    '/',
    listCoachingBookingsHandler[0] as any,
    listCoachingBookingsHandler.at(-1) as any,
  )
  expect(
    (await a.request('/?kind=COACH&dateFrom=2026-11-05&dateTo=2026-11-03'))
      .status,
  ).toBe(422)
  expect(mocks.coaches).not.toHaveBeenCalled()
})

it('accepts coach and ballboy without a payment method or receipt confirmation', async () => {
  const res = await validationApp.request('/detail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotIds: ['coach', 'ballboy'] }),
  })
  expect(res.status).toBe(200)
})
