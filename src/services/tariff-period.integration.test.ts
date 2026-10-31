import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('./recurring-booking.service', () => ({
  ensureRecurringBookings: vi.fn(),
}))
import { db } from '@/lib/prisma'
import { withBranchContext } from '@/lib/branch-context'
import dayjs from '@/lib/club-time'
import {
  bookingWindowEnd,
  rollingCourtPricingSchema,
} from '@/lib/rolling-booking-window'
import {
  saveRollingCourtSchedule,
  ensureRollingCourtSchedules,
} from './rolling-court-schedule.service'
import { saveTariffPeriod } from './tariff-settings.service'
import { getTariffPeriods } from './tariff-policy.service'
import { claimSlotsAtomically } from './slot-claim.service'

const run = process.env.RUN_TARIFF_DB_TESTS === '1' ? describe : describe.skip
run('tariff periods against local PostgreSQL', () => {
  const prefix = `tariff-test-${Date.now()}`
  const branches = [`${prefix}-a`, `${prefix}-b`]
  const courts = [`${prefix}-court-a`, `${prefix}-court-b`]
  const now = new Date()
  const at = (days: number) =>
    dayjs(now)
      .add(days, 'day')
      .hour(16)
      .minute(0)
      .second(0)
      .millisecond(0)
      .toDate()
  const asBranch = <T>(branchId: string, fn: () => T) =>
    withBranchContext({ branchId, isAdmin: true, isSuperAdmin: true }, fn)
  const input = {
    sport: 'PADEL' as const,
    effectiveFrom: dayjs(now).add(3, 'day').format('YYYY-MM-DD'),
    happyStart: 6,
    happyEnd: 17,
    peakStart: 17,
    peakEnd: 24,
  }
  beforeAll(async () => {
    if (
      !['localhost', '127.0.0.1', '::1'].includes(
        new URL(process.env.DATABASE_URL!).hostname,
      )
    )
      throw new Error('Use a local development database for this test.')
    await db.branch.createMany({
      data: branches.map((id) => ({
        id,
        name: id,
        address: 'Tariff integration fixture',
      })),
    })
    for (let i = 0; i < branches.length; i++) {
      await db.court.create({
        data: {
          id: courts[i],
          name: courts[i],
          branchId: branches[i],
          sport: 'PADEL',
        },
      })
      const config = rollingCourtPricingSchema.parse({
        courtId: courts[i],
        months: 1,
        days: [1, 2, 3, 4, 5, 6, 7],
        happyHourPrice: 100,
        peakHourPrice: 200,
      })
      await asBranch(branches[i], () => saveRollingCourtSchedule(config, now))
    }
  })
  afterAll(async () => {
    await db.bookingDetail.deleteMany({ where: { courtId: { in: courts } } })
    await db.booking.deleteMany({ where: { branchId: { in: branches } } })
    await db.user.deleteMany({ where: { id: prefix } })
    await db.tariffPeriod.deleteMany({ where: { branchId: { in: branches } } })
    await db.slot.deleteMany({ where: { courtId: { in: courts } } })
    await db.courtCostSchedule.deleteMany({
      where: { courtId: { in: courts } },
    })
    await db.court.deleteMany({ where: { id: { in: courts } } })
    await db.branch.deleteMany({ where: { id: { in: branches } } })
    await db.$disconnect()
  })
  it('reprices future open slots while preserving booked slots, manual closures and other branches', async () => {
    const slot = await db.slot.findUniqueOrThrow({
      where: { courtId_startAt: { courtId: courts[0], startAt: at(5) } },
    })
    const manual = await db.slot.findUniqueOrThrow({
      where: { courtId_startAt: { courtId: courts[0], startAt: at(6) } },
    })
    await db.user.create({
      data: { id: prefix, name: 'Tariff fixture', phone: prefix },
    })
    const booking = await db.booking.create({
      data: { branchId: branches[0], userId: prefix, status: 'CONFIRMED' },
    })
    await db.bookingDetail.create({
      data: {
        bookingId: booking.id,
        courtId: courts[0],
        slotId: slot.id,
        price: slot.price,
      },
    })
    await db.slot.updateMany({
      where: { id: { in: [slot.id, manual.id] } },
      data: { isAvailable: false },
    })
    await asBranch(branches[0], () => saveTariffPeriod(branches[0], input, now))
    const read = (courtId: string, days: number) =>
      db.slot.findUniqueOrThrow({
        where: { courtId_startAt: { courtId, startAt: at(days) } },
      })
    expect((await read(courts[0], 1)).price).toBe(200)
    expect((await read(courts[0], 4)).price).toBe(100)
    expect((await read(courts[1], 4)).price).toBe(200)
    expect(await read(courts[0], 5)).toMatchObject({
      id: slot.id,
      price: 200,
      isAvailable: false,
      scheduleClosed: false,
      startAt: slot.startAt,
      endAt: slot.endAt,
    })
    expect(await read(courts[0], 6)).toMatchObject({
      id: manual.id,
      price: 200,
      isAvailable: false,
    })
    expect(
      (
        await db.bookingDetail.findFirstOrThrow({
          where: { bookingId: booking.id },
        })
      ).price,
    ).toBe(200)
  })
  it('uses the same policy for dates newly exposed by the rolling window', async () => {
    const later = dayjs(now).add(7, 'day').toDate()
    await asBranch(branches[0], () =>
      ensureRollingCourtSchedules(courts[0], later),
    )
    const fresh = await db.slot.findMany({
      where: { courtId: courts[0], startAt: { gt: bookingWindowEnd(1, now) } },
    })
    expect(fresh.length).toBeGreaterThan(0)
    expect(
      fresh
        .filter((slot) => dayjs(slot.startAt).hour() === 16)
        .every((slot) => slot.price === 100),
    ).toBe(true)
    const all = await db.slot.findMany({ where: { courtId: courts[0] } })
    expect(new Set(all.map((slot) => +slot.startAt)).size).toBe(all.length)
  })
  it('keeps an existing reservation outside new hours, but prevents rebooking it after cancellation', async () => {
    const startAt = dayjs(at(4)).hour(6).toDate()
    const slot = await db.slot.findUniqueOrThrow({
      where: { courtId_startAt: { courtId: courts[0], startAt } },
    })
    const booking = await db.booking.create({
      data: { branchId: branches[0], userId: prefix, status: 'CONFIRMED' },
    })
    await db.bookingDetail.create({
      data: {
        bookingId: booking.id,
        courtId: courts[0],
        slotId: slot.id,
        price: slot.price,
      },
    })
    await db.slot.update({
      where: { id: slot.id },
      data: { isAvailable: false },
    })
    await asBranch(branches[0], () =>
      saveTariffPeriod(branches[0], { ...input, happyStart: 8 }, now),
    )
    expect(
      await db.slot.findUniqueOrThrow({ where: { id: slot.id } }),
    ).toMatchObject({
      startAt: slot.startAt,
      endAt: slot.endAt,
      price: slot.price,
      isAvailable: false,
      scheduleClosed: true,
    })
    expect(
      (
        await db.bookingDetail.findFirstOrThrow({
          where: { bookingId: booking.id },
        })
      ).price,
    ).toBe(slot.price)
    await db.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED' },
    })
    await db.slot.update({
      where: { id: slot.id },
      data: { isAvailable: true },
    })
    await expect(
      asBranch(branches[0], () =>
        db.$transaction((tx) =>
          claimSlotsAtomically(tx, {
            slotIds: [slot.id],
            type: 'COURT',
            windowAt: now,
          }),
        ),
      ),
    ).rejects.toThrow('unavailable')
  })
  it('isolates reads and refuses a cross-branch write', async () => {
    expect(await asBranch(branches[1], () => getTariffPeriods())).toEqual([])
    await expect(
      asBranch(branches[1], () => saveTariffPeriod(branches[0], input, now)),
    ).rejects.toThrow('Cabang tidak sesuai')
  })
})
