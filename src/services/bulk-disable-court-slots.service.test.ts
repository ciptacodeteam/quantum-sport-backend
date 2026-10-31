import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { $transaction: async (fn: any) => fn({ slot: mocks }) },
}))

import { bulkDisableCourtSlots } from './bulk-disable-court-slots.service'
import { bulkDisableCourtSlotsSchema } from '@/lib/validation'

const payload = {
  courtId: 'court',
  fromDate: '2026-11-01',
  toDate: '2026-11-01',
  days: [7],
  startHour: 17,
  endHour: 22,
}
beforeEach(() => vi.clearAllMocks())

it('filters by Jakarta weekday and hours, and excludes bookings atomically when disabling', async () => {
  mocks.findMany.mockResolvedValue([
    { id: 'before', startAt: new Date('2026-11-01T09:00:00Z') },
    { id: 'start', startAt: new Date('2026-11-01T10:00:00Z') },
    { id: 'booked-or-closed', startAt: new Date('2026-11-01T11:00:00Z') },
    { id: 'last', startAt: new Date('2026-11-01T14:00:00Z') },
    { id: 'end', startAt: new Date('2026-11-01T15:00:00Z') },
    { id: 'monday', startAt: new Date('2026-11-02T10:00:00Z') },
  ])
  mocks.updateMany.mockResolvedValue({ count: 2 })
  expect(await bulkDisableCourtSlots(payload)).toEqual({
    matchedCount: 3,
    updatedCount: 2,
    skippedCount: 1,
  })
  expect(mocks.findMany.mock.calls[0][0].where).toEqual({
    courtId: 'court',
    type: 'COURT',
    startAt: {
      gte: new Date('2026-10-31T17:00:00Z'),
      lte: new Date('2026-11-01T16:59:59.999Z'),
    },
  })
  expect(mocks.updateMany).toHaveBeenCalledWith({
    where: {
      id: { in: ['start', 'booked-or-closed', 'last'] },
      courtId: 'court',
      type: 'COURT',
      isAvailable: true,
      scheduleClosed: false,
      bookingDetails: { none: { booking: { status: { not: 'CANCELLED' } } } },
    },
    data: { isAvailable: false },
  })
})

it('does not write when no slots match', async () => {
  mocks.findMany.mockResolvedValue([])
  expect(await bulkDisableCourtSlots(payload)).toEqual({
    matchedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
  })
  expect(mocks.updateMany).not.toHaveBeenCalled()
})

it.each([
  { toDate: '2026-10-31' },
  { fromDate: '2026-02-30' },
  { fromDate: '2026-11-01T00:00:00Z' },
  { days: [] },
  { days: [0] },
  { days: [1.5] },
  { endHour: 17 },
  { startHour: 17.5 },
  { endHour: 25 },
])('rejects invalid bulk filters: %j', (invalid) => {
  expect(
    bulkDisableCourtSlotsSchema.safeParse({ ...payload, ...invalid }).success,
  ).toBe(false)
})

it('accepts midnight as the exclusive end of the selected day without price fields', () => {
  expect(
    bulkDisableCourtSlotsSchema.safeParse({ ...payload, endHour: 24 }).success,
  ).toBe(true)
})
