import {
  lockCustomerWallet,
  withCustomerWallet,
} from './membership-renewal.service'
import { chargeDueRecurringMembershipSessions } from './recurring-membership-usage.service'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/prisma'
import dayjs from '@/lib/club-time'
import { BadRequestException } from '@/exceptions'
import { bookingWindowEnd } from '@/lib/rolling-booking-window'
import { bookableCourtWhere } from '@/lib/court-branch-policy'
import { branchContext, withBranchContext } from '@/lib/branch-context'
import {
  dateOnly,
  dateOnlyKey,
  recurringTemplatesSchema,
  type RecurringBookingInput,
} from '@/lib/recurring-booking'
import { claimSlotsAtomically } from './slot-claim.service'
import { generateInvoiceNumber } from '@/lib/utils'
import { log } from '@/lib/logger'
import {
  planRecurringSessions,
  recurringSource,
  type PlannedSlot,
} from './recurring-plan.service'

type Tx = Prisma.TransactionClient
async function coveredBooking(
  tx: Tx,
  branchId: string,
  userId: string,
  membershipUserId: string,
  seriesId: string,
) {
  return tx.booking.create({
    data: {
      branchId,
      userId,
      status: 'CONFIRMED',
      holdExpiresAt: null,
      membershipUserId,
      membershipSessionsUsed: 0,
      totalPrice: 0,
      courtNormalPrice: 0,
      courtDiscountPrice: 0,
      adminNote: `Booking rutin membership. Kuota dipotong saat jam bermain (WIB). Aturan: ${seriesId}`,
    },
  })
}
async function coveredInvoice(
  tx: Tx,
  branchId: string,
  userId: string,
  bookingId: string,
  slots: Pick<PlannedSlot, 'startAt'>[],
  now: Date,
) {
  await tx.invoice.create({
    data: {
      branchId,
      userId,
      bookingId,
      number: await generateInvoiceNumber(),
      subtotal: 0,
      total: 0,
      status: 'PAID',
      paidAt: now,
      dueDate: slots.reduce(
        (first, s) => (s.startAt < first ? s.startAt : first),
        slots[0].startAt,
      ),
    },
  })
}
/** Every playing date has its own booking/invoice, including the initial preview. */
export async function createRecurringBooking(
  tx: Tx,
  input: RecurringBookingInput,
  userId: string,
  bookingId: string,
  checkedOutSlotIds: string[],
  membershipUserId?: string,
  now = new Date(),
) {
  if (!membershipUserId)
    throw new BadRequestException(
      'Booking rutin hanya untuk pelanggan membership.',
    )
  if (!input.sourceSlotIds.every((id) => checkedOutSlotIds.includes(id)))
    throw new BadRequestException(
      'Jadwal awal booking berulang telah dihapus. Pilih ulang jadwal berulang.',
    )
  const { templates, branchId } = await recurringSource(tx, input, now)
  await lockCustomerWallet(tx, userId)
  const endKey =
    input.mode === 'MONTHS'
      ? dayjs(input.startDate).add(input.months!, 'month').format('YYYY-MM-DD')
      : input.mode === 'DATES'
        ? input.endDate!
        : null
  const series = await tx.recurringBooking.create({
    data: {
      branchId,
      userId,
      membershipUserId,
      weekdays: [...new Set(input.weekdays)],
      templates,
      startDate: dateOnly(input.startDate),
      endDate: endKey ? dateOnly(endKey) : null,
      processedThrough: dateOnly(input.startDate),
    },
  })
  const booked = await tx.slot.findMany({
    where: { id: { in: checkedOutSlotIds }, type: 'COURT' },
  })
  const dates = [
    ...new Set(booked.map((s) => dayjs(s.startAt).format('YYYY-MM-DD'))),
  ]
  for (const date of dates) {
    const slots = booked.filter(
      (s) => dayjs(s.startAt).format('YYYY-MM-DD') === date,
    )
    if (
      !templates.every((template) =>
        slots.some(
          (slot) =>
            slot.courtId === template.courtId &&
            dayjs(slot.startAt).format('HH:mm') === template.time &&
            dayjs(slot.endAt).diff(dayjs(slot.startAt), 'minute') ===
              template.durationMinutes,
        ),
      )
    ) {
      throw new BadRequestException(
        `Jadwal terpilih ${date} belum lengkap. Samakan lapangan dan jam dengan jadwal awal atau hapus pilihan tanggal tersebut.`,
      )
    }
    let dateBookingId = bookingId
    if (date !== input.startDate) {
      const separate = await coveredBooking(
        tx,
        branchId,
        userId,
        membershipUserId,
        series.id,
      )
      dateBookingId = separate.id
      await tx.bookingDetail.updateMany({
        where: { bookingId, slotId: { in: slots.map((s) => s.id) } },
        data: { bookingId: dateBookingId },
      })
      await coveredInvoice(tx, branchId, userId, dateBookingId, slots, now)
    }
    await tx.recurringBookingOccurrence.create({
      data: {
        branchId,
        seriesId: series.id,
        date: dateOnly(date),
        bookingId: dateBookingId,
      },
    })
  }
  // Initial checkout and the complete selected range commit together. A stale
  // conflict rolls everything back unless the administrator explicitly allows skips.
  await withCustomerWallet(() =>
    extendRecurringBookingTx(tx, series.id, now, !input.skipConflicts),
  )
  return series
}

async function extendRecurringBookingTx(
  tx: Tx,
  seriesId: string,
  now: Date,
  failOnConflicts = false,
) {
  const series = await tx.recurringBooking.findUnique({
    where: { id: seriesId },
  })
  if (!series?.isActive) return
  const membership = await tx.membershipUser.findUnique({
    where: { id: series.membershipUserId },
    include: { membership: true },
  })
  if (
    !membership ||
    membership.userId !== series.userId ||
    membership.isSuspended
  )
    return
  const templates = recurringTemplatesSchema.parse(series.templates)
  const courtIds = [...new Set(templates.map((t) => t.courtId))]
  const courts = await tx.court.findMany({
    where: {
      id: { in: courtIds },
      branchId: series.branchId,
      ...bookableCourtWhere,
    },
    include: { branch: { select: { isActive: true } } },
  })
  if (
    courts.length !== courtIds.length ||
    courts.some((c) => !c.bookingWindowMonths || !c.branch.isActive)
  ) {
    if (failOnConflicts)
      throw new BadRequestException(
        'Lapangan atau cabang booking rutin tidak aktif.',
      )
    return
  }
  const endKey = series.endDate ? dateOnlyKey(series.endDate) : null
  // Explicit recurring periods can reserve beyond the public rolling window.
  // Open-ended rules continue to extend as the regular window advances.
  const horizon =
    endKey ??
    courts
      .map((c) =>
        dayjs(bookingWindowEnd(c.bookingWindowMonths!, now)).format(
          'YYYY-MM-DD',
        ),
      )
      .sort()[0]!
  const next = dayjs(dateOnlyKey(series.processedThrough))
    .add(1, 'day')
    .format('YYYY-MM-DD')
  const today = dayjs(now).format('YYYY-MM-DD'),
    first = next < today ? today : next
  if (first > horizon) {
    if (endKey)
      await tx.recurringBooking.update({
        where: { id: seriesId },
        data: { isActive: false },
      })
    return
  }
  const occurrences = await tx.recurringBookingOccurrence.findMany({
    where: { seriesId },
    select: { date: true },
  })
  const existingDates = new Set(occurrences.map((o) => dateOnlyKey(o.date)))
  const plan = await planRecurringSessions(
    tx,
    courts,
    templates,
    first,
    horizon,
    series.weekdays,
    now,
    membership.membership.type,
  )
  for (const session of plan) {
    if (existingDates.has(session.date)) continue
    if (session.conflicts.length) {
      if (failOnConflicts)
        throw new BadRequestException(
          `Jadwal ${session.date} tidak tersedia. Periksa ulang atau pilih lewati sesi bentrok.`,
        )
      await tx.recurringBookingOccurrence.create({
        data: {
          branchId: series.branchId,
          seriesId,
          date: dateOnly(session.date),
          reason: session.conflicts.join('; '),
        },
      })
      continue
    }
    const missing = session.slots.filter((s) => !s.id)
    if (missing.length)
      await tx.slot.createMany({
        data: missing.map((s) => ({ ...s, type: 'COURT', isAvailable: true })),
        skipDuplicates: true,
      })
    const valid = await tx.slot.findMany({
      where: {
        branchId: series.branchId,
        type: 'COURT',
        OR: session.slots.map((s) => ({
          courtId: s.courtId,
          startAt: s.startAt,
          endAt: s.endAt,
        })),
      },
    })
    if (valid.length !== session.slots.length)
      throw new BadRequestException(
        'Jadwal berubah ketika booking rutin disimpan. Silakan periksa kembali.',
      )
    await claimSlotsAtomically(tx, {
      slotIds: valid.map((s) => s.id),
      type: 'COURT',
      startsAfter: now,
      windowAt: now,
      allowOutsideWindow: !!endKey,
    })
    const booking = await coveredBooking(
      tx,
      series.branchId,
      series.userId,
      series.membershipUserId,
      seriesId,
    )
    await tx.bookingDetail.createMany({
      data: valid.map((s) => ({
        bookingId: booking.id,
        slotId: s.id,
        courtId: s.courtId,
        price: s.price,
        discountPrice: s.discountPrice > 0 ? s.discountPrice : s.price,
      })),
    })
    await coveredInvoice(
      tx,
      series.branchId,
      series.userId,
      booking.id,
      valid,
      now,
    )
    await tx.recurringBookingOccurrence.create({
      data: {
        branchId: series.branchId,
        seriesId,
        date: dateOnly(session.date),
        bookingId: booking.id,
      },
    })
  }
  if (horizon >= next)
    await tx.recurringBooking.update({
      where: { id: seriesId },
      data: {
        processedThrough: dateOnly(horizon),
        ...(endKey ? { isActive: false } : {}),
      },
    })
}

/** Authorize in the caller's branch, then serialize shared-wallet and rule changes. */
export async function extendRecurringBooking(
  seriesId: string,
  now = new Date(),
) {
  const allowed = await db.recurringBooking.findUnique({
    where: { id: seriesId },
    select: { userId: true, branchId: true },
  })
  if (!allowed) return
  return withCustomerWallet(() =>
    db.$transaction(async (tx) => {
      await lockCustomerWallet(tx, allowed.userId)
      await tx.$queryRaw`SELECT id FROM recurring_bookings WHERE id = ${seriesId} FOR UPDATE`
      await extendRecurringBookingTx(tx, seriesId, now)
    }),
  )
}

export async function ensureRecurringBookings(now = new Date()) {
  const rules = await db.recurringBooking.findMany({
    where: { isActive: true },
    select: { id: true, branchId: true },
  })
  for (const rule of rules) {
    const context = branchContext.getStore()
    try {
      await withBranchContext(
        {
          branchId: rule.branchId,
          isAdmin: true,
          isSuperAdmin: true,
          ...(context?.staffId ? { staffId: context.staffId } : {}),
        },
        () => extendRecurringBooking(rule.id, now),
      )
    } catch (error) {
      log.error(
        { error, seriesId: rule.id },
        'Recurring reservation extension failed; will retry',
      )
    }
  }
  await chargeDueRecurringMembershipSessions(now)
}
