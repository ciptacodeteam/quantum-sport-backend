import { beforeEach, expect, it, vi } from 'vitest'
import type { Court } from '@prisma/client'
const mocks = vi.hoisted(() => ({ rules: vi.fn() }))
vi.mock('./tariff-policy.service', () => ({ getTariffPeriods: mocks.rules }))
import { planRecurringSessions, recurringEnd } from './recurring-plan.service'
import dayjs from '@/lib/club-time'
const now = new Date('2026-10-30T03:00:00Z')
const court = {
  id: 'a',
  branchId: 'cemara',
  name: 'Court A',
  sport: 'PADEL',
  bookingWindowMonths: 1,
  rollingPricing: {
    days: [1, 2, 3, 4, 5, 6, 7],
    happyHourPrice: 100,
    peakHourPrice: 200,
    closedHours: [],
  },
} as unknown as Court
const template = {
  courtId: 'a',
  courtName: 'Court A',
  time: '19:00',
  durationMinutes: 60,
}
const tx = (slots: any[] = []) =>
  ({ slot: { findMany: vi.fn(async () => slots) } }) as any
beforeEach(() => mocks.rules.mockResolvedValue([]))
it('previews a full requested duration beyond the one-month public schedule in WIB', async () => {
  expect(
    recurringEnd(
      { mode: 'MONTHS', months: 3, startDate: '2026-11-03' },
      [court],
      now,
    ),
  ).toBe('2027-02-03')
  const plan = await planRecurringSessions(
    tx(),
    [court],
    [template],
    '2026-11-03',
    '2027-02-03',
    [2],
    now,
  )
  expect(plan.length).toBeGreaterThan(10)
  expect(plan.at(-1)!.slots[0].startAt.getUTCHours()).toBe(12)
  expect(plan.at(-1)!.slots[0].id).toBeUndefined()
})
it('preserves manual closures and stale occupied slots instead of reopening them', async () => {
  const slot = {
    id: 'closed',
    courtId: 'a',
    branchId: 'cemara',
    startAt: dayjs('2026-11-03 19:00').toDate(),
    endAt: dayjs('2026-11-03 20:00').toDate(),
    isAvailable: false,
    scheduleClosed: false,
    bookingDetails: [],
  }
  const plan = await planRecurringSessions(
    tx([slot]),
    [court],
    [template],
    '2026-11-03',
    '2026-11-03',
    [2],
    now,
  )
  expect(plan[0].slots).toEqual([])
  const occupied = await planRecurringSessions(
    tx([{ ...slot, isAvailable: true, bookingDetails: [{ id: 'occupied' }] }]),
    [court],
    [template],
    '2026-11-03',
    '2026-11-03',
    [2],
    now,
  )
  expect(occupied[0].conflicts).toHaveLength(1)
})
it('respects future bulk disable rules even where no published slot exists', async () => {
  const closed = {
    ...court,
    rollingPricing: {
      ...(court.rollingPricing as object),
      bulkRules: [
        {
          kind: 'disable',
          fromDate: '2026-11-01',
          days: [2],
          startHour: 19,
          endHour: 20,
        },
      ],
    },
  }
  const plan = await planRecurringSessions(
    tx(),
    [closed],
    [template],
    '2026-11-03',
    '2026-12-03',
    [2],
    now,
  )
  expect(
    plan.every(
      (session) => session.conflicts.length === 1 && !session.slots.length,
    ),
  ).toBe(true)
})
it('evaluates package hours on each playing date when future tariff rules change', async () => {
  mocks.rules.mockResolvedValue([
    {
      branchId: 'cemara',
      sport: 'PADEL',
      effectiveFrom: '2027-01-01',
      happyStart: 15,
      happyEnd: 24,
      peakStart: 6,
      peakEnd: 15,
    },
  ])
  const plan = await planRecurringSessions(
    tx(),
    [court],
    [template],
    '2026-11-03',
    '2027-02-03',
    [2],
    now,
    'AFTER_HOUR',
  )
  expect(plan[0].conflicts).toEqual([])
  expect(plan.at(-1)!.slots).toEqual([])
  expect(plan.at(-1)!.conflicts).toHaveLength(1)
})
it('rejects overlapping published intervals rather than manufacturing a second reservation', async () => {
  const overlap = {
    id: 'overlap',
    courtId: 'a',
    startAt: dayjs('2026-11-03 18:30').toDate(),
    endAt: dayjs('2026-11-03 19:30').toDate(),
    isAvailable: true,
    scheduleClosed: false,
    bookingDetails: [],
  }
  const plan = await planRecurringSessions(
    tx([overlap]),
    [court],
    [template],
    '2026-11-03',
    '2026-11-03',
    [2],
    now,
  )
  expect(plan[0].conflicts).toHaveLength(1)
})
it('keeps legacy manually published rolling reservations valid without inventing unpublished slots', async () => {
  const legacy = { ...court, rollingPricing: null }
  const slot = {
    id: 'manual',
    courtId: 'a',
    startAt: dayjs('2026-11-03 19:00').toDate(),
    endAt: dayjs('2026-11-03 20:00').toDate(),
    price: 200,
    discountPrice: 0,
    isAvailable: true,
    scheduleClosed: false,
    bookingDetails: [],
  }
  const plan = await planRecurringSessions(
    tx([slot]),
    [legacy],
    [template],
    '2026-11-03',
    '2026-11-10',
    [2],
    now,
  )
  expect(plan[0].slots[0].id).toBe('manual')
  expect(plan[1].slots).toEqual([])
  expect(plan[1].conflicts).toHaveLength(1)
})
