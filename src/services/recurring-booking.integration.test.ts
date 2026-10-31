import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminCheckoutHandler } from '@/handlers/admin/checkout.handler'
import { createRouter } from '@/lib/create-app'
import { log } from '@/lib/logger'
import { db } from '@/lib/prisma'
import dayjs from '@/lib/club-time'
import { withBranchContext } from '@/lib/branch-context'
import { dateOnly, dateOnlyKey } from '@/lib/recurring-booking'
import {
  createRecurringBooking,
  extendRecurringBooking,
} from './recurring-booking.service'
import { chargeDueRecurringMembershipSessions } from './recurring-membership-usage.service'
import {
  saveRollingCourtSchedule,
  ensureRollingCourtSchedules,
} from './rolling-court-schedule.service'
import { membershipTransactionStatusWhere } from '@/lib/membership-transaction-filter'

const run =
  process.env.RUN_RECURRING_DB_TESTS === '1' ? describe : describe.skip
run('recurring membership reservations against PostgreSQL', () => {
  const prefix = `recurring-test-${Date.now()}`
  const branchId = `${prefix}-branch`,
    courtId = `${prefix}-court`,
    userId = `${prefix}-user`,
    membershipId = `${prefix}-pack`,
    packId = `${prefix}-wallet`
  const today = new Date()
  const start = dayjs(today).add(1, 'day').format('YYYY-MM-DD')
  let seriesId: string, initialBooking: string, initialSlot: string
  const asBranch = <T>(fn: () => T) =>
    withBranchContext({ branchId, isAdmin: true, isSuperAdmin: true }, fn)
  beforeAll(async () => {
    await db.branch.create({
      data: { id: branchId, name: prefix, address: 'Test' },
    })
    await db.user.create({
      data: { id: userId, name: prefix, phone: prefix, password: 'test-only' },
    })
    await db.membership.create({
      data: {
        id: membershipId,
        name: prefix,
        price: 100,
        sessions: 1,
        duration: 1,
        branches: { create: { branchId } },
      },
    })
    await db.membershipUser.create({
      data: {
        id: packId,
        userId,
        membershipId,
        remainingSessions: 0,
        remainingDuration: 1,
        startDate: today,
        endDate: dayjs(today).add(1, 'hour').toDate(),
      },
    })
    await db.invoice.create({
      data: {
        branchId,
        userId,
        membershipUserId: packId,
        number: prefix,
        subtotal: 100,
        total: 100,
        status: 'PAID',
        dueDate: today,
        paidAt: today,
      },
    })
    await db.court.create({ data: { id: courtId, branchId, name: prefix } })
    await asBranch(() =>
      saveRollingCourtSchedule(
        {
          courtId,
          months: 1,
          days: [1, 2, 3, 4, 5, 6, 7],
          happyHourPrice: 100,
          happyHourDiscountPrice: 0,
          peakHourPrice: 200,
          peakHourDiscountPrice: 0,
          closedHours: [],
        },
        today,
      ),
    )
    const slot = await db.slot.findFirstOrThrow({
      where: { courtId, startAt: dayjs(`${start} 14:00`).toDate() },
    })
    initialSlot = slot.id
    const booking = await db.booking.create({
      data: { branchId, userId, membershipUserId: packId, status: 'CONFIRMED' },
    })
    initialBooking = booking.id
    await db.bookingDetail.create({
      data: { bookingId: booking.id, courtId, slotId: slot.id, price: 100 },
    })
    await db.slot.update({
      where: { id: slot.id },
      data: { isAvailable: false },
    })
    const series = await asBranch(() =>
      db.$transaction((tx) =>
        createRecurringBooking(
          tx,
          {
            mode: 'ROLLING',
            weekdays: [dayjs(start).day()],
            startDate: start,
            previewThrough: start,
            sourceSlotIds: [slot.id],
          },
          userId,
          booking.id,
          [slot.id],
          packId,
          today,
        ),
      ),
    )
    seriesId = series.id
  })
  afterAll(async () => {
    await db.membershipSessionDebit.deleteMany({ where: { branchId } })
    await db.recurringBookingOccurrence.deleteMany({ where: { branchId } })
    await db.recurringBooking.deleteMany({ where: { branchId } })
    await db.invoice.deleteMany({ where: { branchId } })
    await db.bookingDetail.deleteMany({ where: { courtId } })
    await db.booking.deleteMany({ where: { branchId } })
    await db.slot.deleteMany({ where: { courtId } })
    await db.courtCostSchedule.deleteMany({ where: { courtId } })
    await db.court.deleteMany({ where: { id: courtId } })
    await db.membershipUser.deleteMany({ where: { id: packId } })
    await db.membershipBranch.deleteMany({ where: { membershipId } })
    await db.membership.deleteMany({ where: { id: membershipId } })
    await db.user.deleteMany({ where: { id: userId } })
    await db.branch.deleteMany({ where: { id: branchId } })
    await db.$disconnect()
  })
  it('admin checkout requires membership and defers its debit even with zero balance', async () => {
    const app = createRouter()
    app.use('*', async (c, next) => {
      c.set('logger', log as never)
      await next()
    })
    app.post('/checkout', ...adminCheckoutHandler)
    const slot = await db.slot.findFirstOrThrow({
      where: { courtId, startAt: dayjs(`${start} 17:00`).toDate() },
    })
    const response = await asBranch(() =>
      app.request('/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          totalHours: 1,
          courtSlots: [slot.id],
          useMembership: true,
          recurringBooking: {
            mode: 'MONTHS',
            months: 1,
            startDate: start,
            previewThrough: start,
            weekdays: [dayjs(start).day()],
            sourceSlotIds: [slot.id],
          },
        }),
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { bookingId: string } }
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: body.data.bookingId },
    })
    expect(booking.membershipSessionsUsed).toBe(0)
    expect(booking.membershipUserId).toBe(packId)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: packId } }))
        .remainingSessions,
    ).toBe(0)
    // Stop this additional test rule so the main rollover assertions stay focused.
    await db.recurringBooking.updateMany({
      where: { branchId, id: { not: seriesId } },
      data: { isActive: false },
    })
  })
  it('does not charge at checkout or before the session starts', async () => {
    await asBranch(() =>
      chargeDueRecurringMembershipSessions(dayjs(`${start} 13:59:59`).toDate()),
    )
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: packId } }))
        .remainingSessions,
    ).toBe(0)
    expect(await db.membershipSessionDebit.count({ where: { branchId } })).toBe(
      0,
    )
  })
  it('charges at 14:00, allows a negative expired membership, and is safe under concurrent retries', async () => {
    const atStart = dayjs(`${start} 14:00`).toDate()
    await Promise.all([
      asBranch(() => chargeDueRecurringMembershipSessions(atStart)),
      asBranch(() => chargeDueRecurringMembershipSessions(atStart)),
    ])
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: packId } }))
        .remainingSessions,
    ).toBe(-1)
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: initialBooking } }))
        .membershipSessionsUsed,
    ).toBe(1)
    expect(await db.membershipSessionDebit.count({ where: { branchId } })).toBe(
      1,
    )
    expect(
      await db.membershipUser.count({
        where: {
          id: packId,
          ...membershipTransactionStatusWhere('Saldo minus'),
        },
      }),
    ).toBe(1)
  })
  it('extends despite exhausted membership, skips complete conflicting sessions, and does not duplicate dates', async () => {
    const conflictDate = dayjs(start).add(7, 'day').format('YYYY-MM-DD')
    await db.slot.updateMany({
      where: { courtId, startAt: dayjs(`${conflictDate} 14:00`).toDate() },
      data: { isAvailable: false },
    })
    await Promise.all([
      asBranch(() => extendRecurringBooking(seriesId, today)),
      asBranch(() => extendRecurringBooking(seriesId, today)),
    ])
    const occurrences = await db.recurringBookingOccurrence.findMany({
      where: { seriesId },
    })
    expect(occurrences.length).toBeGreaterThan(2)
    expect(
      new Set(occurrences.map((item) => dateOnlyKey(item.date))).size,
    ).toBe(occurrences.length)
    expect(
      occurrences.find((item) => dateOnlyKey(item.date) === conflictDate)
        ?.bookingId,
    ).toBeNull()
    const generated = await db.booking.findFirstOrThrow({
      where: { branchId, id: { not: initialBooking } },
      include: { invoice: true },
    })
    expect(generated).toMatchObject({
      status: 'CONFIRMED',
      membershipUserId: packId,
      membershipSessionsUsed: 0,
      totalPrice: 0,
    })
    expect(generated.invoice?.total).toBe(0)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: packId } }))
        .remainingSessions,
    ).toBe(-1)
  })
  it('does not charge cancelled future sessions', async () => {
    const generated = await db.booking.findFirstOrThrow({
      where: { branchId, id: { not: initialBooking } },
      include: { details: { include: { slot: true } } },
    })
    await db.booking.update({
      where: { id: generated.id },
      data: { status: 'CANCELLED' },
    })
    await asBranch(() =>
      chargeDueRecurringMembershipSessions(generated.details[0]!.slot.startAt),
    )
    expect(
      await db.membershipSessionDebit.count({
        where: { detailId: generated.details[0]!.id },
      }),
    ).toBe(0)
  })
  it('adds newly exposed dates when rolling advances, including expired membership', async () => {
    const previous = await db.recurringBooking.findUniqueOrThrow({
      where: { id: seriesId },
    })
    const beforeCount = await db.recurringBookingOccurrence.count({
      where: { seriesId },
    })
    await db.membershipUser.update({
      where: { id: packId },
      data: {
        isExpired: true,
        endDate: dayjs(today).subtract(1, 'day').toDate(),
      },
    })
    const later = dayjs(today).add(8, 'day').toDate()
    await asBranch(() => ensureRollingCourtSchedules(courtId, later))
    const updated = await db.recurringBooking.findUniqueOrThrow({
      where: { id: seriesId },
    })
    expect(
      dateOnlyKey(updated.processedThrough) >
        dateOnlyKey(previous.processedThrough),
    ).toBe(true)
    expect(
      await db.recurringBookingOccurrence.count({ where: { seriesId } }),
    ).toBeGreaterThan(beforeCount)
  })
  it('a month-based rule has a fixed month boundary and automatically completes there', async () => {
    const slot = await db.slot.findFirstOrThrow({
      where: { courtId, startAt: dayjs(`${start} 16:00`).toDate() },
    })
    await db.bookingDetail.create({
      data: { bookingId: initialBooking, courtId, slotId: slot.id, price: 200 },
    })
    await db.slot.update({
      where: { id: slot.id },
      data: { isAvailable: false },
    })
    const finite = await asBranch(() =>
      db.$transaction((tx) =>
        createRecurringBooking(
          tx,
          {
            mode: 'MONTHS',
            months: 1,
            weekdays: [dayjs(start).day()],
            startDate: start,
            previewThrough: start,
            sourceSlotIds: [slot.id],
          },
          userId,
          initialBooking,
          [slot.id],
          packId,
          today,
        ),
      ),
    )
    expect(dateOnlyKey(finite.endDate!)).toBe(
      dayjs(start).add(1, 'month').format('YYYY-MM-DD'),
    )
    await asBranch(() =>
      extendRecurringBooking(finite.id, dayjs(today).add(8, 'day').toDate()),
    )
    expect(
      (
        await db.recurringBooking.findUniqueOrThrow({
          where: { id: finite.id },
        })
      ).isActive,
    ).toBe(false)
    const dates = await db.recurringBookingOccurrence.findMany({
      where: { seriesId: finite.id },
    })
    expect(dates.every((item) => item.date <= finite.endDate!)).toBe(true)
  })
  it('a stopped rule creates no new reservations and leaves current bookings intact', async () => {
    const before = await db.booking.count({ where: { branchId } })
    await db.recurringBooking.update({
      where: { id: seriesId },
      data: {
        isActive: false,
        stoppedAt: today,
        processedThrough: dateOnly(start),
      },
    })
    await asBranch(() => extendRecurringBooking(seriesId, today))
    expect(await db.booking.count({ where: { branchId } })).toBe(before)
    expect(
      (await db.slot.findUniqueOrThrow({ where: { id: initialSlot } }))
        .isAvailable,
    ).toBe(false)
  })
})
