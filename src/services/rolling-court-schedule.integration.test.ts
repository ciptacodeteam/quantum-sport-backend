import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/prisma'
import dayjs from '@/lib/club-time'
import { withBranchContext } from '@/lib/branch-context'
import {
  bookingWindowEnd,
  rollingBookingWindowWhere,
  rollingCourtPricingSchema,
} from '@/lib/rolling-booking-window'
import {
  ensureRollingCourtSchedules,
  saveRollingCourtSchedule,
} from './rolling-court-schedule.service'
import { claimSlotsAtomically } from './slot-claim.service'

const run = process.env.RUN_ROLLING_DB_TESTS === '1' ? describe : describe.skip
run('rolling schedules against PostgreSQL', () => {
  const prefix = `rolling-test-${Date.now()}`
  const a = `${prefix}-a`,
    b = `${prefix}-b`,
    courtId = `${prefix}-court`
  const config = rollingCourtPricingSchema.parse({
    courtId,
    months: 1,
    days: [1, 2, 3, 4, 5, 6, 7],
    happyHourPrice: 100,
    peakHourPrice: 200,
  })
  const now = new Date()
  const asBranch = <T>(id: string, fn: () => T) =>
    withBranchContext({ branchId: id, isAdmin: true, isSuperAdmin: true }, fn)
  beforeAll(async () => {
    await db.branch.createMany({
      data: [a, b].map((id) => ({ id, name: id, address: 'Test' })),
    })
    await db.court.create({ data: { id: courtId, branchId: a, name: prefix } })
  })
  afterAll(async () => {
    await db.bookingDetail.deleteMany({ where: { courtId } })
    await db.booking.deleteMany({ where: { branchId: a } })
    await db.user.deleteMany({ where: { id: prefix } })
    await db.slot.deleteMany({ where: { courtId } })
    await db.courtCostSchedule.deleteMany({ where: { courtId } })
    await db.court.deleteMany({ where: { id: courtId } })
    await db.branch.deleteMany({ where: { id: { in: [a, b] } } })
    await db.$disconnect()
  })
  it('creates a complete window and rejects a save from another branch', async () => {
    await expect(
      asBranch(b, () => saveRollingCourtSchedule(config, now)),
    ).rejects.toThrow('Court not found')
    await asBranch(a, () => saveRollingCourtSchedule(config, now))
    const slots = await db.slot.findMany({
      where: { courtId },
      orderBy: { startAt: 'asc' },
    })
    expect(slots.length).toBeGreaterThan(400)
    expect(slots.every((s) => s.branchId === a)).toBe(true)
    expect(dayjs(slots.at(-1)!.startAt).format('YYYY-MM-DD')).toBe(
      dayjs(bookingWindowEnd(1, now)).format('YYYY-MM-DD'),
    )
  })
  it('keeps booking IDs/prices/times and manual closures during reconfiguration', async () => {
    const slots = await db.slot.findMany({
      where: { courtId },
      take: 2,
      orderBy: { startAt: 'asc' },
    })
    await db.user.create({
      data: { id: prefix, name: 'Rolling test', phone: prefix },
    })
    const booking = await db.booking.create({
      data: { branchId: a, userId: prefix, status: 'CONFIRMED' },
    })
    await db.bookingDetail.create({
      data: {
        bookingId: booking.id,
        courtId,
        slotId: slots[0].id,
        price: slots[0].price,
      },
    })
    await db.slot.updateMany({
      where: { id: { in: slots.map((s) => s.id) } },
      data: { isAvailable: false },
    })
    await asBranch(a, () =>
      saveRollingCourtSchedule(
        { ...config, happyHourPrice: 300, peakHourPrice: 400 },
        now,
      ),
    )
    const booked = await db.slot.findUniqueOrThrow({
      where: { id: slots[0].id },
    })
    const manual = await db.slot.findUniqueOrThrow({
      where: { id: slots[1].id },
    })
    expect(booked.startAt).toEqual(slots[0].startAt)
    expect(booked.price).toBe(slots[0].price)
    expect(booked.isAvailable).toBe(false)
    expect(manual.isAvailable).toBe(false)
  })
  it('does not duplicate slots when two generators catch up concurrently', async () => {
    const later = dayjs(now).add(7, 'day').toDate()
    await Promise.all([
      asBranch(a, () => ensureRollingCourtSchedules(courtId, later)),
      asBranch(a, () => ensureRollingCourtSchedules(courtId, later)),
    ])
    const slots = await db.slot.findMany({ where: { courtId } })
    expect(new Set(slots.map((s) => +s.startAt)).size).toBe(slots.length)
    expect(Math.max(...slots.map((s) => +s.startAt))).toBeGreaterThan(
      +bookingWindowEnd(1, now),
    )
  })
  it('rejects out-of-window slot IDs and rolls back the claim', async () => {
    const slot = await db.slot.findFirstOrThrow({
      where: { courtId, startAt: { gt: bookingWindowEnd(1, now) } },
    })
    await expect(
      asBranch(a, () =>
        db.$transaction((tx) =>
          claimSlotsAtomically(tx, { slotIds: [slot.id], type: 'COURT' }),
        ),
      ),
    ).rejects.toThrow('unavailable')
    expect(
      (await db.slot.findUniqueOrThrow({ where: { id: slot.id } })).isAvailable,
    ).toBe(true)
    expect(
      await db.slot.count({
        where: { courtId, id: slot.id, ...rollingBookingWindowWhere(now) },
      }),
    ).toBe(0)
  })
  it('can reopen an hour closed by the weekly rule while preserving manual closures', async () => {
    await asBranch(a, () =>
      saveRollingCourtSchedule({ ...config, closedHours: [23] }, now),
    )
    const closed = await db.slot.findFirstOrThrow({
      where: {
        courtId,
        scheduleClosed: true,
        isAvailable: true,
        startAt: { lte: bookingWindowEnd(1, now) },
      },
      orderBy: { startAt: 'desc' },
    })
    await expect(
      asBranch(a, () =>
        db.$transaction((tx) =>
          claimSlotsAtomically(tx, { slotIds: [closed.id], type: 'COURT' }),
        ),
      ),
    ).rejects.toThrow('unavailable')
    await asBranch(a, () => saveRollingCourtSchedule(config, now))
    const reopened = await db.slot.findUniqueOrThrow({
      where: { id: closed.id },
    })
    expect(reopened.scheduleClosed).toBe(false)
  })
  it('reconciles old future rows when a shortened window advances again', async () => {
    await asBranch(a, () =>
      saveRollingCourtSchedule(
        { ...config, months: 2, closedHours: [23] },
        now,
      ),
    )
    const afterEnd = dayjs(bookingWindowEnd(1, now))
      .add(1, 'day')
      .hour(23)
      .minute(0)
      .second(0)
      .millisecond(0)
      .toDate()
    // This row predates the new policy; generation must reuse its ID and clear only the rule closure.
    const old = await db.slot.upsert({
      where: { courtId_startAt: { courtId, startAt: afterEnd } },
      update: { price: 50, scheduleClosed: true },
      create: {
        branchId: a,
        courtId,
        type: 'COURT',
        startAt: afterEnd,
        endAt: dayjs(afterEnd).add(1, 'hour').toDate(),
        price: 50,
        scheduleClosed: true,
      },
    })
    await asBranch(a, () => saveRollingCourtSchedule(config, now))
    expect(
      await db.slot.count({
        where: { id: old.id, ...rollingBookingWindowWhere(now) },
      }),
    ).toBe(0)
    await asBranch(a, () =>
      ensureRollingCourtSchedules(courtId, dayjs(now).add(7, 'day').toDate()),
    )
    const exposed = await db.slot.findUniqueOrThrow({ where: { id: old.id } })
    expect(exposed.scheduleClosed).toBe(false)
    expect(exposed.isAvailable).toBe(true)
    expect(exposed.price).toBe(config.peakHourPrice)
  })
  it('supports lazy generation while a super admin views all branches', async () => {
    await withBranchContext(
      { branchId: null, isAdmin: true, isSuperAdmin: true },
      () =>
        ensureRollingCourtSchedules(
          courtId,
          dayjs(now).add(10, 'day').toDate(),
        ),
    )
    const court = await db.court.findUniqueOrThrow({ where: { id: courtId } })
    expect(court.slotsGeneratedThrough!.toISOString().slice(0, 10)).toBe(
      dayjs(bookingWindowEnd(1, dayjs(now).add(10, 'day').toDate())).format(
        'YYYY-MM-DD',
      ),
    )
  })

  it('allows only one simultaneous checkout to claim the same open slot', async () => {
    const slot = await db.slot.findFirstOrThrow({
      where: {
        courtId,
        isAvailable: true,
        startAt: { gt: now },
        ...rollingBookingWindowWhere(now),
      },
    })
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        asBranch(a, () =>
          db.$transaction((tx) =>
            claimSlotsAtomically(tx, {
              slotIds: [slot.id],
              type: 'COURT',
              startsAfter: now,
            }),
          ),
        ),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })
})
