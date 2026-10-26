import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  createSlots: vi.fn(),
  createPrices: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    $transaction: async (callback: any) =>
      callback({
        slot: {
          findMany: async () => [],
          deleteMany: vi.fn(),
          createMany: mocks.createSlots,
        },
        courtCostSchedule: {
          deleteMany: vi.fn(),
          createMany: mocks.createPrices,
        },
      }),
  },
}))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), fatal: vi.fn() } }))
import { setCourtPricing } from './costing.service'
it('creates all 18 opening hours as Jakarta time when the server runs in UTC', async () => {
  await setCourtPricing({
    courtId: 'court',
    fromDate: '2026-10-23',
    toDate: '2026-10-23',
    days: [5],
    happyHourPrice: 200000,
    peakHourPrice: 300000,
  })
  const slots = mocks.createSlots.mock.calls[0][0].data
  expect(slots).toHaveLength(18)
  expect(slots[0].startAt.toISOString()).toBe('2026-10-22T23:00:00.000Z')
  expect(slots.at(-1).startAt.toISOString()).toBe('2026-10-23T16:00:00.000Z')
  expect(slots.at(-1).endAt.toISOString()).toBe('2026-10-23T17:00:00.000Z')
  expect(slots.at(-1).price).toBe(300000)
})
