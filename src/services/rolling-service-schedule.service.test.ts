import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ db: {} }))
import { reconcileRollingServiceSchedule } from './rolling-service-schedule.service'
const now = new Date('2026-11-01T00:00:00+07:00')
const slot = (id: string, day = '2026-11-02') => ({
  id,
  startAt: new Date(`${day}T13:00:00Z`),
  endAt: new Date(`${day}T14:00:00Z`),
  isAvailable: true,
  scheduleClosed: false,
  price: 100000,
  bookingCoaches: [] as { id: string }[],
  bookingBallboys: [] as { id: string }[],
})
const staff = {
  id: 'coach',
  branchId: 'cemara',
  role: 'COACH',
  coachType: 'PADEL',
  rollingServiceSchedule: {
    followCourtWindow: true,
    days: [1],
    startHour: 13,
    endHour: 14,
    price: 200000,
  },
} as any
let tx: any
beforeEach(() => {
  tx = {
    slot: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi
        .fn()
        .mockImplementation(({ data }) => ({ count: data.length })),
    },
  }
})
it('creates matching court hours once, then extends when another court date enters the window', async () => {
  tx.slot.findMany
    .mockResolvedValueOnce([slot('court')])
    .mockResolvedValueOnce([])
  expect(await reconcileRollingServiceSchedule(tx, staff, now)).toMatchObject({
    created: 1,
  })
  expect(tx.slot.findMany.mock.calls[0][0].where).toMatchObject({
    branchId: 'cemara',
    type: 'COURT',
    AND: expect.arrayContaining([
      {
        court: {
          isActive: true,
          bookingWindowMonths: { not: null },
          sport: 'PADEL',
        },
      },
    ]),
  })
  tx.slot.createMany.mockClear()
  tx.slot.findMany
    .mockResolvedValueOnce([slot('court')])
    .mockResolvedValueOnce([slot('old')])
  expect(await reconcileRollingServiceSchedule(tx, staff, now)).toMatchObject({
    created: 0,
  })
  expect(tx.slot.createMany).not.toHaveBeenCalled()
  tx.slot.findMany
    .mockResolvedValueOnce([slot('court'), slot('next', '2026-11-09')])
    .mockResolvedValueOnce([slot('old')])
  expect(await reconcileRollingServiceSchedule(tx, staff, now)).toMatchObject({
    created: 1,
  })
  expect(tx.slot.createMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: [
        expect.objectContaining({
          staffId: 'coach',
          startAt: new Date('2026-11-09T13:00:00Z'),
          price: 200000,
        }),
      ],
    }),
  )
})
it('preserves booked slots and manual closures while repricing only open matching slots', async () => {
  const booked = {
    ...slot('booked', '2026-11-09'),
    isAvailable: false,
    bookingCoaches: [{ id: 'booking' }],
  }
  const manual = { ...slot('manual', '2026-11-16'), isAvailable: false }
  tx.slot.findMany
    .mockResolvedValueOnce([
      slot('court'),
      slot('court-2', '2026-11-09'),
      slot('court-3', '2026-11-16'),
    ])
    .mockResolvedValueOnce([slot('open'), booked, manual])
  expect(await reconcileRollingServiceSchedule(tx, staff, now, true)).toEqual({
    created: 0,
    updated: 1,
    skipped: 1,
  })
  expect(tx.slot.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['open'] }, isAvailable: true },
    data: { price: 200000, additionalHourPrice: null },
  })
  expect(
    tx.slot.updateMany.mock.calls.some(
      ([arg]: any) => 'isAvailable' in arg.data,
    ),
  ).toBe(false)
  expect(
    tx.slot.updateMany.mock.calls.some(([arg]: any) =>
      arg.where.id.in.includes('booked'),
    ),
  ).toBe(false)
})
it('closes unbooked slots outside the court window and allows ballboys to follow either court sport', async () => {
  tx.slot.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([slot('outside')])
  await reconcileRollingServiceSchedule(
    tx,
    { ...staff, role: 'BALLBOY', coachType: null },
    now,
  )
  expect(tx.slot.findMany.mock.calls[0][0].where.AND[1].court.sport).toEqual({
    in: ['PADEL', 'TENNIS'],
  })
  expect(tx.slot.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['outside'] } },
    data: { scheduleClosed: true },
  })
  expect(tx.slot.createMany).not.toHaveBeenCalled()
})

it('copies first and additional hour tariffs to open slots and newly generated coach slots', async () => {
  const updated = {
    ...staff,
    rollingServiceSchedule: {
      ...staff.rollingServiceSchedule,
      additionalHourPrice: 100000,
    },
  }
  tx.slot.findMany
    .mockResolvedValueOnce([slot('court'), slot('next', '2026-11-09')])
    .mockResolvedValueOnce([slot('open')])
  await reconcileRollingServiceSchedule(tx, updated, now, true)
  expect(tx.slot.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['open'] }, isAvailable: true },
    data: { price: 200000, additionalHourPrice: 100000 },
  })
  expect(tx.slot.createMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: [
        expect.objectContaining({ price: 200000, additionalHourPrice: 100000 }),
      ],
    }),
  )
})
