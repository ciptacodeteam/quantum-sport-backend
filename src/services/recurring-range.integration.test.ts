import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/prisma'
import dayjs from '@/lib/club-time'
import { withBranchContext } from '@/lib/branch-context'
import { adminCheckoutHandler } from '@/handlers/admin/checkout.handler'
import { previewRecurringBookingHandler } from '@/handlers/admin/recurring-booking.handler'
import { createRouter } from '@/lib/create-app'
import { chargeDueRecurringMembershipSessions } from './recurring-membership-usage.service'
import { saveRollingCourtSchedule } from './rolling-court-schedule.service'
import { rollingBookingWindowWhere } from '@/lib/rolling-booking-window'
import { log } from '@/lib/logger'
const run =
  process.env.RUN_RECURRING_DB_TESTS === '1' ? describe : describe.skip
run('weekly ranges, separate invoices and Jakarta usage time', () => {
  const key = `recurring-range-${Date.now()}`,
    branchId = `${key}-branch`,
    courtId = `${key}-court`,
    userId = `${key}-user`,
    packId = `${key}-pack`,
    walletId = `${key}-wallet`
  const now = new Date(),
    start = dayjs(now).add(1, 'day').format('YYYY-MM-DD'),
    end = dayjs(start).add(3, 'month').format('YYYY-MM-DD')
  const closed = dayjs(start).add(7, 'day').format('YYYY-MM-DD'),
    second = dayjs(start).add(14, 'day').format('YYYY-MM-DD')
  let source: string[],
    selected: string[],
    bookingId: string,
    watermark: Date | null
  const asBranch = <T>(fn: () => T) =>
    withBranchContext({ branchId, isAdmin: true, isSuperAdmin: true }, fn)
  const app = createRouter()
  app.use('*', async (c, next) => {
    c.set('logger', log as never)
    await next()
  })
  app.post('/checkout', ...adminCheckoutHandler)
  app.post('/preview', ...previewRecurringBookingHandler)
  const input = {
    mode: 'MONTHS',
    months: 3,
    startDate: start,
    previewThrough: end,
    weekdays: [dayjs(start).day()],
  }
  const checkout = (skipConflicts: boolean) =>
    asBranch(() =>
      app.request('/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          totalHours: 4,
          courtSlots: selected,
          useMembership: true,
          recurringBooking: { ...input, sourceSlotIds: source, skipConflicts },
        }),
      }),
    )
  beforeAll(async () => {
    await db.branch.create({
      data: { id: branchId, name: key, address: 'Test' },
    })
    await db.user.create({
      data: { id: userId, name: key, phone: key, password: 'test-only' },
    })
    await db.membership.create({
      data: {
        id: packId,
        name: key,
        sessions: 1,
        duration: 1,
        price: 100,
        branches: { create: { branchId } },
      },
    })
    await db.membershipUser.create({
      data: {
        id: walletId,
        userId,
        membershipId: packId,
        startDate: now,
        endDate: dayjs(now).add(1, 'hour').toDate(),
        remainingSessions: 0,
        remainingDuration: 1,
      },
    })
    await db.invoice.create({
      data: {
        branchId,
        userId,
        membershipUserId: walletId,
        number: key,
        subtotal: 100,
        total: 100,
        status: 'PAID',
        paidAt: now,
        dueDate: now,
      },
    })
    await db.court.create({ data: { id: courtId, branchId, name: key } })
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
        now,
      ),
    )
    const slots = await db.slot.findMany({
      where: {
        courtId,
        startAt: {
          in: [start, second].flatMap((date) =>
            [19, 20].map((h) => dayjs(`${date} ${h}:00`).toDate()),
          ),
        },
      },
      orderBy: { startAt: 'asc' },
    })
    selected = slots.map((s) => s.id)
    source = slots
      .filter((s) => dayjs(s.startAt).format('YYYY-MM-DD') === start)
      .map((s) => s.id)
    expect(source).toHaveLength(2)
    expect(selected).toHaveLength(4)
    await db.slot.updateMany({
      where: { courtId, startAt: dayjs(`${closed} 19:00`).toDate() },
      data: { isAvailable: false },
    })
    watermark = (await db.court.findUniqueOrThrow({ where: { id: courtId } }))
      .slotsGeneratedThrough
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
    await db.membershipUser.deleteMany({ where: { id: walletId } })
    await db.membershipBranch.deleteMany({ where: { membershipId: packId } })
    await db.membership.deleteMany({ where: { id: packId } })
    await db.user.deleteMany({ where: { id: userId } })
    await db.branch.deleteMany({ where: { id: branchId } })
    await db.$disconnect()
  })
  it('previews unpublished weeks without creating slots, including whole-session closures', async () => {
    const count = await db.slot.count({ where: { courtId } })
    const response = await asBranch(() =>
      app.request('/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, sourceSlotIds: source }),
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as any
    expect(body.data.through).toBe(end)
    expect(body.data.sessions.length).toBeGreaterThan(10)
    expect(
      body.data.sessions.find((s: any) => s.date === closed).items,
    ).toHaveLength(0)
    expect(body.data.sessions.at(-1).items).toHaveLength(2)
    expect(await db.slot.count({ where: { courtId } })).toBe(count)
  })
  it('rolls back a stale/conflicting series unless skipping is explicitly accepted', async () => {
    const response = await checkout(false)
    expect(response.status).toBe(400)
    expect(await db.booking.count({ where: { branchId } })).toBe(0)
    expect(await db.recurringBooking.count({ where: { branchId } })).toBe(0)
    expect(
      (await db.slot.findUniqueOrThrow({ where: { id: source[0] } }))
        .isAvailable,
    ).toBe(true)
  })
  it('reserves the full three-month range despite a one-month public window, with one invoice per date', async () => {
    const response = await checkout(true)
    expect(response.status).toBe(200)
    const body = (await response.json()) as any
    bookingId = body.data.bookingId
    const bookings = await db.booking.findMany({
      where: { branchId },
      include: { invoice: true, details: { include: { slot: true } } },
    })
    expect(bookings.length).toBeGreaterThan(10)
    expect(new Set(bookings.map((b) => b.invoice?.id)).size).toBe(
      bookings.length,
    )
    expect(new Set(bookings.map((b) => b.invoice?.number)).size).toBe(
      bookings.length,
    )
    for (const booking of bookings) {
      expect(booking.details).toHaveLength(2)
      expect(
        new Set(
          booking.details.map((d) =>
            dayjs(d.slot.startAt).format('YYYY-MM-DD'),
          ),
        ).size,
      ).toBe(1)
      expect(booking).toMatchObject({
        membershipUserId: walletId,
        membershipSessionsUsed: 0,
        totalPrice: 0,
      })
      expect(booking.invoice?.total).toBe(0)
    }
    const court = await db.court.findUniqueOrThrow({ where: { id: courtId } })
    expect(court.bookingWindowMonths).toBe(1)
    expect(court.slotsGeneratedThrough).toEqual(watermark)
    const outside = await db.slot.findFirstOrThrow({
      where: {
        courtId,
        startAt: { gt: dayjs(start).add(2, 'month').toDate() },
      },
    })
    expect(
      await db.slot.count({
        where: { id: outside.id, ...rollingBookingWindowWhere(now) },
      }),
    ).toBe(0)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: walletId } }))
        .remainingSessions,
    ).toBe(0)
  })
  it('debits each hour only at 19:00/20:00 WIB, allowing minus after expiry without duplicate charges', async () => {
    await db.membershipUser.update({
      where: { id: walletId },
      data: {
        isExpired: true,
        endDate: dayjs(now).subtract(1, 'hour').toDate(),
      },
    })
    const at19 = dayjs(`${start} 19:00`).toDate()
    expect(at19.toISOString()).toContain('T12:00:00.000Z')
    await asBranch(() =>
      chargeDueRecurringMembershipSessions(new Date(+at19 - 1)),
    )
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: walletId } }))
        .remainingSessions,
    ).toBe(0)
    await Promise.all([
      asBranch(() => chargeDueRecurringMembershipSessions(at19)),
      asBranch(() => chargeDueRecurringMembershipSessions(at19)),
    ])
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: walletId } }))
        .remainingSessions,
    ).toBe(-1)
    expect(await db.membershipSessionDebit.count({ where: { branchId } })).toBe(
      1,
    )
    await asBranch(() =>
      chargeDueRecurringMembershipSessions(dayjs(`${start} 20:00`).toDate()),
    )
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: walletId } }))
        .remainingSessions,
    ).toBe(-2)
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: bookingId } }))
        .membershipSessionsUsed,
    ).toBe(2)
  })
  it('does not debit a weekly invoice cancelled before its playing time', async () => {
    const future = await db.booking.findFirstOrThrow({
      where: {
        branchId,
        details: {
          some: { slot: { startAt: dayjs(`${second} 19:00`).toDate() } },
        },
      },
    })
    await db.booking.update({
      where: { id: future.id },
      data: { status: 'CANCELLED' },
    })
    await asBranch(() =>
      chargeDueRecurringMembershipSessions(dayjs(`${second} 20:00`).toDate()),
    )
    expect(await db.membershipSessionDebit.count({ where: { branchId } })).toBe(
      2,
    )
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: walletId } }))
        .remainingSessions,
    ).toBe(-2)
  })
})
