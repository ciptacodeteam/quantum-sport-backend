import { adminMembershipCheckoutHandler } from '@/handlers/admin/membership.handler'
import { approveMembershipTransactionHandler } from '@/handlers/admin/membership-transaction.handler'
import { createRouter } from '@/lib/create-app'
import { log } from '@/lib/logger'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/prisma'
import dayjs from '@/lib/club-time'
import { withBranchContext } from '@/lib/branch-context'
import { dateOnly } from '@/lib/recurring-booking'
import {
  applyPaidMembershipRenewal,
  creditMembershipIncludingTransferredDebt,
  restoreRecurringMembershipDebits,
  withCustomerWallet,
} from './membership-renewal.service'
import { activateMembershipAfterPayment } from './membership-activation.service'
import { finalizeSuccessfulPayment } from './payment-reconcile.service'
import { chargeDueRecurringMembershipSessions } from './recurring-membership-usage.service'
import { extendRecurringBooking } from './recurring-booking.service'

const run =
  process.env.RUN_MEMBERSHIP_RENEWAL_DB_TESTS === '1' ? describe : describe.skip
run('paid package renewal against PostgreSQL', () => {
  const prefix = `renewal-test-${Date.now()}`
  const a = `${prefix}-a`,
    b = `${prefix}-b`,
    userId = `${prefix}-user`,
    courtId = `${prefix}-court`
  const oldPack = `${prefix}-old`,
    target = `${prefix}-new`,
    tennis = `${prefix}-tennis`,
    series = `${prefix}-rule`,
    bookingId = `${prefix}-booking`
  const now = new Date(),
    future = dayjs(now)
      .add(1, 'day')
      .hour(14)
      .minute(0)
      .second(0)
      .millisecond(0)
      .toDate()
  const asA = <T>(fn: () => T) =>
    withBranchContext({ branchId: a, isAdmin: true, isSuperAdmin: true }, fn)
  const asB = <T>(fn: () => T) =>
    withBranchContext({ branchId: b, isAdmin: true, isSuperAdmin: true }, fn)
  async function pack(
    id: string,
    sport: 'PADEL' | 'TENNIS',
    sessions: number,
    balance: number,
    paid = true,
    owner = userId,
    branchId = a,
  ) {
    await db.membership.create({
      data: {
        id: `${id}-product`,
        name: id,
        sport,
        sessions,
        price: 100,
        duration: 30,
        branches: { create: { branchId } },
      },
    })
    await db.membershipUser.create({
      data: {
        id,
        userId: owner,
        membershipId: `${id}-product`,
        startDate: dayjs(now).subtract(40, 'day').toDate(),
        endDate: dayjs(now).subtract(10, 'day').toDate(),
        remainingSessions: balance,
        remainingDuration: 0,
        isExpired: paid,
        isSuspended: !paid,
        suspensionReason: paid ? null : 'Awaiting payment',
      },
    })
    await db.invoice.create({
      data: {
        id: `${id}-invoice`,
        number: id,
        branchId,
        userId: owner,
        membershipUserId: id,
        status: paid ? 'PAID' : 'PENDING',
        subtotal: 100,
        total: 100,
        dueDate: future,
        paidAt: paid ? now : null,
      },
    })
  }
  beforeAll(async () => {
    await db.branch.createMany({
      data: [a, b].map((id) => ({ id, name: id, address: 'Test' })),
    })
    await db.user.create({
      data: { id: userId, name: prefix, phone: prefix, password: 'test-only' },
    })
    await pack(oldPack, 'PADEL', 1, -2)
    await pack(target, 'PADEL', 10, 10, false, userId, b)
    await pack(tennis, 'TENNIS', 10, -4)
    await db.court.create({
      data: { id: courtId, branchId: a, name: prefix, bookingWindowMonths: 1 },
    })
    await db.booking.create({
      data: {
        id: bookingId,
        userId,
        branchId: a,
        membershipUserId: oldPack,
        membershipSessionsUsed: 3,
        status: 'CONFIRMED',
      },
    })
    for (const [suffix, start, hours] of [
      ['past', dayjs(now).subtract(1, 'day').toDate(), 3],
      ['future', future, 1],
    ] as const) {
      await db.slot.create({
        data: {
          id: `${prefix}-${suffix}`,
          courtId,
          branchId: a,
          type: 'COURT',
          startAt: start,
          endAt: dayjs(start).add(hours, 'hour').toDate(),
          price: 100,
          isAvailable: false,
        },
      })
      await db.bookingDetail.create({
        data: {
          id: `${prefix}-${suffix}-detail`,
          bookingId,
          courtId,
          slotId: `${prefix}-${suffix}`,
          price: 100,
        },
      })
    }
    await db.membershipSessionDebit.create({
      data: {
        branchId: a,
        detailId: `${prefix}-past-detail`,
        membershipUserId: oldPack,
        sessions: 3,
        chargedAt: dayjs(now).subtract(1, 'day').toDate(),
      },
    })
    await db.recurringBooking.create({
      data: {
        id: series,
        userId,
        branchId: a,
        membershipUserId: oldPack,
        weekdays: [dayjs(future).day()],
        templates: [
          { courtId, courtName: prefix, time: '14:00', durationMinutes: 60 },
        ],
        startDate: dateOnly(dayjs(future).format('YYYY-MM-DD')),
        processedThrough: dateOnly(dayjs(future).format('YYYY-MM-DD')),
      },
    })
    await db.recurringBookingOccurrence.create({
      data: {
        branchId: a,
        seriesId: series,
        bookingId,
        date: dateOnly(dayjs(future).format('YYYY-MM-DD')),
      },
    })
  })
  afterAll(async () => {
    await db.membershipSessionDebit.deleteMany({
      where: { branchId: { in: [a, b] } },
    })
    await db.recurringBookingOccurrence.deleteMany({
      where: { branchId: { in: [a, b] } },
    })
    await db.recurringBooking.deleteMany({
      where: { branchId: { in: [a, b] } },
    })
    await db.membershipDebtTransfer.deleteMany({
      where: { fromMembershipUser: { userId } },
    })
    await db.invoice.deleteMany({ where: { userId } })
    await db.bookingDetail.deleteMany({ where: { courtId } })
    await db.booking.deleteMany({ where: { userId } })
    await db.slot.deleteMany({ where: { courtId } })
    await db.court.deleteMany({ where: { id: courtId } })
    await db.membershipUser.deleteMany({ where: { userId } })
    await db.membershipBranch.deleteMany({
      where: { branchId: { in: [a, b] } },
    })
    await db.membership.deleteMany({ where: { name: { startsWith: prefix } } })
    await db.user.deleteMany({ where: { id: userId } })
    await db.branch.deleteMany({ where: { id: { in: [a, b] } } })
    await db.$disconnect()
  })
  it('does nothing for an unpaid purchase', async () => {
    expect(
      await asB(() =>
        db.$transaction((tx) => applyPaidMembershipRenewal(tx, target)),
      ),
    ).toBeNull()
    expect(
      await asB(() =>
        db.$transaction((tx) => activateMembershipAfterPayment(tx, target)),
      ),
    ).toBe(false)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: oldPack } }))
        .remainingSessions,
    ).toBe(-2)
    expect(
      (await db.recurringBooking.findUniqueOrThrow({ where: { id: series } }))
        .membershipUserId,
    ).toBe(oldPack)
  })
  it('settles debt only after payment, preserves purchase duration, and is idempotent under concurrent callbacks', async () => {
    const pay = () =>
      asB(() =>
        db.$transaction((tx) =>
          finalizeSuccessfulPayment(tx, {
            invoiceId: `${target}-invoice`,
            paidAt: now,
          }),
        ),
      )
    await Promise.all([pay(), pay()])
    const updated = await db.membershipUser.findUniqueOrThrow({
      where: { id: target },
    })
    expect(updated).toMatchObject({
      remainingSessions: 8,
      debtSettledSessions: 2,
      isSuspended: false,
      isExpired: false,
    })
    expect(updated.startDate).toEqual(now)
    expect(updated.endDate).toEqual(dayjs(now).add(30, 'day').toDate())
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: oldPack } }))
        .remainingSessions,
    ).toBe(0)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: tennis } }))
        .remainingSessions,
    ).toBe(-4)
    expect(
      await db.membershipDebtTransfer.count({
        where: { toMembershipUserId: target },
      }),
    ).toBe(1)
    expect(
      (await db.recurringBooking.findUniqueOrThrow({ where: { id: series } }))
        .membershipUserId,
    ).toBe(target)
    await asB(() =>
      db.$transaction((tx) =>
        activateMembershipAfterPayment(
          tx,
          target,
          dayjs(now).add(1, 'day').toDate(),
        ),
      ),
    )
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: target } }))
        .startDate,
    ).toEqual(now)
  })
  it('charges existing future reservations to the new package without rewriting the past ledger', async () => {
    await asA(() => chargeDueRecurringMembershipSessions(future))
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: target } }))
        .remainingSessions,
    ).toBe(7)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: oldPack } }))
        .remainingSessions,
    ).toBe(0)
    expect(
      (
        await db.membershipSessionDebit.findUniqueOrThrow({
          where: { detailId: `${prefix}-past-detail` },
        })
      ).membershipUserId,
    ).toBe(oldPack)
    expect(
      (
        await db.membershipSessionDebit.findUniqueOrThrow({
          where: { detailId: `${prefix}-future-detail` },
        })
      ).membershipUserId,
    ).toBe(target)
  })
  it('new rolling dates use the new package, including the customer shared wallet across branches', async () => {
    const next = dayjs(future).add(7, 'day').toDate()
    await db.slot.create({
      data: {
        id: `${prefix}-next`,
        courtId,
        branchId: a,
        type: 'COURT',
        startAt: next,
        endAt: dayjs(next).add(1, 'hour').toDate(),
        price: 100,
        isAvailable: true,
      },
    })
    await asA(() => extendRecurringBooking(series, now))
    expect(
      await db.booking.count({
        where: {
          userId,
          membershipUserId: target,
          recurringOccurrences: { some: { seriesId: series } },
        },
      }),
    ).toBeGreaterThan(0)
  })
  it('refunds a booking spanning two packages and settled debt once, without losing or duplicating quota', async () => {
    await db.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED' },
    })
    expect(
      await asA(() =>
        db.$transaction((tx) =>
          restoreRecurringMembershipDebits(tx, bookingId),
        ),
      ),
    ).toBe(4)
    expect(
      await asA(() =>
        db.$transaction((tx) =>
          restoreRecurringMembershipDebits(tx, bookingId),
        ),
      ),
    ).toBe(0)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: target } }))
        .remainingSessions,
    ).toBe(10)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: oldPack } }))
        .remainingSessions,
    ).toBe(1)
  })
  it('carries insufficient purchases as a negative new balance and handles subsequent purchases', async () => {
    const debtPack = `${prefix}-large-debt`,
      small = `${prefix}-small`,
      refill = `${prefix}-refill`
    // Stop the fixture's routine so this test only exercises balance transfers.
    await db.recurringBooking.update({
      where: { id: series },
      data: { isActive: false },
    })
    await pack(debtPack, 'PADEL', 1, -12)
    await pack(small, 'PADEL', 10, 10)
    await asA(() =>
      db.$transaction((tx) => applyPaidMembershipRenewal(tx, small)),
    )
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: small } }))
        .remainingSessions,
    ).toBe(-2)
    await pack(refill, 'PADEL', 10, 10)
    await Promise.all([
      asA(() =>
        db.$transaction((tx) => applyPaidMembershipRenewal(tx, refill)),
      ),
      asA(() =>
        db.$transaction((tx) => applyPaidMembershipRenewal(tx, refill)),
      ),
    ])
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: refill } }))
        .remainingSessions,
    ).toBe(8)
    await withCustomerWallet(() =>
      db.$transaction((tx) =>
        creditMembershipIncludingTransferredDebt(tx, debtPack, 13),
      ),
    )
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: debtPack } }))
        .remainingSessions,
    ).toBe(1)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: small } }))
        .remainingSessions,
    ).toBe(10)
    expect(
      (await db.membershipUser.findUniqueOrThrow({ where: { id: refill } }))
        .remainingSessions,
    ).toBe(10)
    expect(
      (await db.recurringBooking.findUniqueOrThrow({ where: { id: series } }))
        .isActive,
    ).toBe(false)
  })
  it('direct admin purchase settles debt while preserving the chosen start date', async () => {
    await pack(`${prefix}-admin-debt`, 'PADEL', 1, -3)
    const product = `${prefix}-admin-product`
    await db.membership.create({
      data: {
        id: product,
        name: product,
        sport: 'PADEL',
        sessions: 10,
        price: 100,
        duration: 30,
        branches: { create: { branchId: a } },
      },
    })
    const app = createRouter()
    app.use('*', async (c, next) => {
      c.set('logger', log as never)
      await next()
    })
    app.post('/checkout', ...adminMembershipCheckoutHandler)
    const startDate = dayjs(now).add(2, 'day').toISOString()
    const response = await asA(() =>
      app.request('/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, membershipId: product, startDate }),
      }),
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      data: { membershipUserId: string }
    }
    const purchased = await db.membershipUser.findUniqueOrThrow({
      where: { id: body.data.membershipUserId },
    })
    expect(purchased.remainingSessions).toBe(7)
    expect(purchased.startDate).toEqual(new Date(startDate))
  })
  it('admin payment approval activates and settles a pending package', async () => {
    await pack(`${prefix}-approval-debt`, 'PADEL', 1, -2)
    const pending = `${prefix}-approval-new`
    await pack(pending, 'PADEL', 10, 10, false)
    const app = createRouter()
    app.use('*', async (c, next) => {
      c.set('logger', log as never)
      await next()
    })
    app.put('/approve/:id', ...approveMembershipTransactionHandler)
    const response = await asA(() =>
      app.request(`/approve/${pending}`, { method: 'PUT' }),
    )
    expect(response.status).toBe(200)
    const purchased = await db.membershipUser.findUniqueOrThrow({
      where: { id: pending },
    })
    expect(purchased).toMatchObject({
      remainingSessions: 8,
      isSuspended: false,
      debtSettledSessions: 2,
    })
  })
})
