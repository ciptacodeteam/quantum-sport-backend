vi.mock('@/services/tariff-policy.service', () => ({
  getTariffPeriods: vi.fn().mockResolvedValue([]),
}))
import { beforeEach, expect, it, vi } from 'vitest'
import dayjs from '@/lib/club-time'
import {
  bookingWindowEnd,
  rollingCourtPricingSchema,
} from '@/lib/rolling-booking-window'
import type { RollingSlotRule } from '@/lib/rolling-slot-rule'

const mocks = vi.hoisted(() => ({
  court: {} as any,
  slotRows: [] as any[],
  createSlots: vi.fn(),
  createCosts: vi.fn(),
  updateSlots: vi.fn(),
  updatePrices: vi.fn(),
  updateCosts: vi.fn(),
  lock: vi.fn(),
}))
vi.mock('@/services/recurring-booking.service', () => ({
  ensureRecurringBookings: vi.fn(),
}))
vi.mock('@/lib/prisma', () => {
  const court = {
    findUnique: async () => mocks.court,
    findUniqueOrThrow: async () => mocks.court,
    findMany: async () => [mocks.court],
    update: async ({ data }: any) =>
      (mocks.court = { ...mocks.court, ...data }),
  }
  const tx = {
    court,
    $queryRaw: mocks.lock,
    slot: {
      findMany: async () => mocks.slotRows,
      createMany: mocks.createSlots,
      updateMany: mocks.updateSlots,
      updateManyAndReturn: mocks.updatePrices,
    },
    courtCostSchedule: {
      createMany: mocks.createCosts,
      updateMany: mocks.updateCosts,
    },
  }
  return { db: { court, $transaction: async (fn: any) => fn(tx) } }
})
import {
  ensureRollingCourtSchedules,
  saveRollingCourtSchedule,
  saveRollingCourtSlotRule,
} from './rolling-court-schedule.service'

const now = new Date('2026-10-30T02:00:00Z')
const config = rollingCourtPricingSchema.parse({
  courtId: 'court',
  months: 1,
  days: [1, 2, 3, 4, 5, 6, 7],
  happyHourPrice: 100,
  peakHourPrice: 200,
})
const rule: RollingSlotRule = {
  kind: 'pricing',
  fromDate: '2026-10-30',
  days: [1, 2, 3, 4, 5, 6, 7],
  startHour: 17,
  endHour: 19,
  price: 500,
  discountPrice: 400,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.court = {
    id: 'court',
    branchId: 'branch',
    isActive: true,
    bookingWindowMonths: 1,
    slotsGeneratedThrough: new Date('2026-11-30T00:00:00Z'),
    rollingPricing: config,
  }
  mocks.slotRows = [
    { id: 'match', startAt: new Date('2026-10-30T10:00:00Z') },
    { id: 'booked', startAt: new Date('2026-10-30T11:00:00Z') },
    { id: 'outside', startAt: new Date('2026-10-30T12:00:00Z') },
  ]
  mocks.updateSlots.mockResolvedValue({ count: 1 })
  mocks.updatePrices.mockResolvedValue([{ startAt: mocks.slotRows[0].startAt }])
})

it('persists a pricing rule and changes only matching future slots inside the current window', async () => {
  const result = await saveRollingCourtSlotRule('court', rule, now)
  expect(result).toMatchObject({
    rollingRuleSaved: true,
    matchedCount: 2,
    updatedCount: 1,
  })
  expect(mocks.court.rollingPricing.bulkRules).toEqual([rule])
  expect(mocks.lock).toHaveBeenCalled()
  expect(mocks.updatePrices).toHaveBeenCalledWith({
    where: {
      courtId: 'court',
      type: 'COURT',
      id: { in: ['match', 'booked'] },
      scheduleClosed: false,
      bookingDetails: { none: { booking: { status: { not: 'CANCELLED' } } } },
    },
    data: { price: 500, discountPrice: 400 },
    select: { startAt: true },
  })
  expect(mocks.updateCosts).toHaveBeenCalledWith({
    where: { courtId: 'court', startAt: { in: [mocks.slotRows[0].startAt] } },
    data: { price: 500, discountPrice: 400 },
  })
})

it('keeps pricing and disable rules when extending the window into new dates', async () => {
  const closure: RollingSlotRule = { ...rule, kind: 'disable' }
  await saveRollingCourtSlotRule('court', rule, now)
  await saveRollingCourtSlotRule('court', closure, now)
  vi.clearAllMocks()
  const later = dayjs(now).add(2, 'day').toDate()
  await ensureRollingCourtSchedules('court', later)
  const slots = mocks.createSlots.mock.calls[0][0].data
  expect(slots.length).toBeGreaterThan(0)
  expect(
    slots.every(
      (slot: any) => dayjs(slot.startAt).format('YYYY-MM-DD') > '2026-11-30',
    ),
  ).toBe(true)
  expect(
    slots.find((slot: any) => dayjs(slot.startAt).hour() === 17),
  ).toMatchObject({ price: 500, discountPrice: 400 })
  expect(
    slots.find((slot: any) => dayjs(slot.startAt).hour() === 19).price,
  ).toBe(200)
  const disable = mocks.updateSlots.mock.calls.find(
    ([args]) => args.data.isAvailable === false,
  )![0]
  expect(disable.where).toMatchObject({
    isAvailable: true,
    bookingDetails: { none: { booking: { status: { not: 'CANCELLED' } } } },
  })
  expect(
    disable.where.startAt.in.every((time: Date) =>
      [17, 18].includes(dayjs(time).hour()),
    ),
  ).toBe(true)
  expect(mocks.createSlots.mock.calls[0][0].skipDuplicates).toBe(true)
  expect(mocks.court.slotsGeneratedThrough.toISOString().slice(0, 10)).toBe(
    dayjs(bookingWindowEnd(1, later)).format('YYYY-MM-DD'),
  )
})

it('preserves bulk rules when changing the main duration and base prices', async () => {
  mocks.court.rollingPricing = { ...config, bulkRules: [rule] }
  await saveRollingCourtSchedule(
    { ...config, months: 2, peakHourPrice: 300 },
    now,
  )
  expect(mocks.court.rollingPricing.bulkRules).toEqual([rule])
  const slots = mocks.createSlots.mock.calls[0][0].data
  expect(
    slots.find((slot: any) => dayjs(slot.startAt).hour() === 17).price,
  ).toBe(500)
  expect(
    slots.find((slot: any) => dayjs(slot.startAt).hour() === 19).price,
  ).toBe(300)
})

it('saves rules even when there are currently no matching slots', async () => {
  mocks.slotRows = []
  expect(await saveRollingCourtSlotRule('court', rule, now)).toMatchObject({
    rollingRuleSaved: true,
    updatedCount: 0,
  })
  expect(mocks.court.rollingPricing.bulkRules).toEqual([rule])
})

it('rejects rolling bulk rules for a court without an automatic schedule', async () => {
  mocks.court.bookingWindowMonths = null
  await expect(saveRollingCourtSlotRule('court', rule, now)).rejects.toThrow(
    'jadwal otomatis',
  )
})
