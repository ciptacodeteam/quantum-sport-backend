import { getTariffPeriods } from './tariff-policy.service'
import { isSlotAllowedForMembershipType } from '@/lib/membership-hours'
import {
  lockCustomerWallet,
  withCustomerWallet,
} from './membership-renewal.service'
import { chargeDueRecurringMembershipSessions } from './recurring-membership-usage.service'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/prisma'
import dayjs from '@/lib/club-time'
import { BadRequestException } from '@/exceptions'
import {
  bookingWindowEnd,
  rollingBookingWindowWhere,
} from '@/lib/rolling-booking-window'
import { bookableCourtWhere } from '@/lib/court-branch-policy'
import { branchContext, withBranchContext } from '@/lib/branch-context'
import {
  dateOnly,
  dateOnlyKey,
  matchingDates,
  recurringTemplatesSchema,
  type RecurringBookingInput,
} from '@/lib/recurring-booking'
import { claimSlotsAtomically } from './slot-claim.service'
import { generateInvoiceNumber } from '@/lib/utils'
import { log } from '@/lib/logger'

type Tx = Prisma.TransactionClient

/** Persist the rule in the same transaction as the initial checkout. */
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
  const ids = [...new Set(input.sourceSlotIds)]
  if (!ids.every((id) => checkedOutSlotIds.includes(id)))
    throw new BadRequestException(
      'Jadwal awal booking berulang telah dihapus. Pilih ulang jadwal berulang.',
    )
  const source = await tx.slot.findMany({
    where: {
      id: { in: ids },
      type: 'COURT',
      court: { is: bookableCourtWhere },
    },
    include: { court: true },
  })
  if (
    source.length !== ids.length ||
    source.some(
      (slot) =>
        !slot.court ||
        !slot.court.bookingWindowMonths ||
        dayjs(slot.startAt).format('YYYY-MM-DD') !== input.startDate,
    )
  ) {
    throw new BadRequestException(
      'Booking berulang membutuhkan lapangan dengan rolling window aktif dan jadwal awal pada satu tanggal.',
    )
  }
  const branches = new Set(source.map((slot) => slot.branchId))
  if (branches.size !== 1)
    throw new BadRequestException('Pilih lapangan dalam satu cabang.')
  const branchId = source[0]!.branchId
  const templates = source.map((slot) => ({
    courtId: slot.courtId!,
    courtName: slot.court!.name,
    time: dayjs(slot.startAt).format('HH:mm'),
    durationMinutes: dayjs(slot.endAt).diff(dayjs(slot.startAt), 'minute'),
  }))
  const endKey =
    input.mode === 'MONTHS'
      ? dayjs(input.startDate).add(input.months!, 'month').format('YYYY-MM-DD')
      : null
  const windowKey = source
    .map((slot) =>
      dayjs(bookingWindowEnd(slot.court!.bookingWindowMonths!, now)).format(
        'YYYY-MM-DD',
      ),
    )
    .sort()[0]!
  const horizon = endKey && endKey < windowKey ? endKey : windowKey
  if (
    input.previewThrough < input.startDate ||
    input.previewThrough > horizon ||
    input.startDate < dayjs(now).format('YYYY-MM-DD')
  )
    throw new BadRequestException(
      'Periode booking berubah. Periksa ulang jadwal berulang.',
    )
  const series = await tx.recurringBooking.create({
    data: {
      branchId,
      userId,
      membershipUserId,
      weekdays: [...new Set(input.weekdays)],
      templates,
      startDate: dateOnly(input.startDate),
      endDate: endKey ? dateOnly(endKey) : null,
      processedThrough: dateOnly(input.previewThrough),
    },
  })
  const booked = await tx.slot.findMany({
    where: { id: { in: checkedOutSlotIds }, type: 'COURT' },
  })
  for (const date of matchingDates(
    input.startDate,
    input.previewThrough,
    input.weekdays,
  )) {
    const complete = templates.every((template) =>
      booked.some(
        (slot) =>
          slot.courtId === template.courtId &&
          dayjs(slot.startAt).format('YYYY-MM-DD HH:mm') ===
            `${date} ${template.time}` &&
          dayjs(slot.endAt).diff(dayjs(slot.startAt), 'minute') ===
            template.durationMinutes,
      ),
    )
    await tx.recurringBookingOccurrence.create({
      data: {
        branchId,
        seriesId: series.id,
        date: dateOnly(date),
        bookingId: complete ? bookingId : null,
        reason: complete ? null : 'Dilewati saat checkout awal oleh admin.',
      },
    })
  }
  return series
}

/** Row lock serializes competing workers, on-read generation, and the admin stop action. */
export async function extendRecurringBooking(
  seriesId: string,
  now = new Date(),
) {
  // Authorize the rule in the caller's branch before using the customer's shared wallet.
  const allowed = await db.recurringBooking.findUnique({
    where: { id: seriesId },
    select: { userId: true, branchId: true },
  })
  if (!allowed) return
  return withCustomerWallet(() =>
    db.$transaction(async (tx) => {
      const identity = await tx.recurringBooking.findUnique({
        where: { id: seriesId },
        select: { userId: true },
      })
      if (!identity) return
      await lockCustomerWallet(tx, identity.userId)
      await tx.$queryRaw`SELECT id FROM recurring_bookings WHERE id = ${seriesId} FOR UPDATE`
      const series = await tx.recurringBooking.findUnique({
        where: { id: seriesId, branchId: allowed.branchId },
      })
      if (!series?.isActive) return
      const membership = await withCustomerWallet(() =>
        tx.membershipUser.findUnique({
          where: { id: series.membershipUserId },
          include: { membership: true },
        }),
      )
      if (
        !membership ||
        membership.userId !== series.userId ||
        membership.isSuspended
      )
        return
      const templates = recurringTemplatesSchema.parse(series.templates)
      const courtIds = [
        ...new Set(templates.map((template) => template.courtId)),
      ]
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
        courts.some(
          (court) => !court.bookingWindowMonths || !court.branch.isActive,
        )
      )
        return
      const membershipTariffRules = await getTariffPeriods(tx)
      const endKey = series.endDate ? dateOnlyKey(series.endDate) : null
      const windowKey = courts
        .map((court) =>
          dayjs(bookingWindowEnd(court.bookingWindowMonths!, now)).format(
            'YYYY-MM-DD',
          ),
        )
        .sort()[0]!
      const horizon = endKey && endKey < windowKey ? endKey : windowKey
      const next = dayjs(dateOnlyKey(series.processedThrough))
        .add(1, 'day')
        .format('YYYY-MM-DD')
      const today = dayjs(now).format('YYYY-MM-DD')
      // A stopped scheduler never recreates sessions in the past.
      const first = next < today ? today : next
      for (const date of matchingDates(first, horizon, series.weekdays)) {
        const starts = templates.map((template) =>
          dayjs(`${date} ${template.time}`).toDate(),
        )
        const slots = await tx.slot.findMany({
          where: {
            ...rollingBookingWindowWhere(now),
            branchId: series.branchId,
            type: 'COURT',
            courtId: { in: courtIds },
            startAt: { in: starts },
            isAvailable: true,
            bookingDetails: {
              none: { booking: { status: { not: 'CANCELLED' } } },
            },
          },
        })
        const selected = templates.map((template) =>
          slots.find(
            (slot) =>
              slot.courtId === template.courtId &&
              dayjs(slot.startAt).format('HH:mm') === template.time &&
              dayjs(slot.endAt).diff(dayjs(slot.startAt), 'minute') ===
                template.durationMinutes &&
              slot.startAt > now &&
              isSlotAllowedForMembershipType(
                membership.membership.type,
                slot.startAt,
                {
                  rules: membershipTariffRules,
                  branchId: series.branchId,
                  sport: courts.find((court) => court.id === slot.courtId)
                    ?.sport,
                  endAt: slot.endAt,
                },
              ),
          ),
        )
        if (selected.some((slot) => !slot)) {
          await tx.recurringBookingOccurrence.create({
            data: {
              branchId: series.branchId,
              seriesId: series.id,
              date: dateOnly(date),
              reason:
                'Sesi dilewati: lapangan/jam tidak tersedia, di luar ketentuan Value Pack, atau sudah terlewati.',
            },
          })
          continue
        }
        const valid = selected.filter(
          (slot): slot is NonNullable<typeof slot> => !!slot,
        )
        await claimSlotsAtomically(tx, {
          slotIds: valid.map((slot) => slot.id),
          type: 'COURT',
          startsAfter: now,
          windowAt: now,
        })
        // Covered by membership; the quota is charged only when each slot starts.
        const booking = await withCustomerWallet(() =>
          tx.booking.create({
            data: {
              branchId: series.branchId,
              userId: series.userId,
              status: 'CONFIRMED',
              holdExpiresAt: null,
              membershipUserId: series.membershipUserId,
              membershipSessionsUsed: 0,
              totalPrice: 0,
              courtNormalPrice: 0,
              courtDiscountPrice: 0,
              adminNote: `Booking rutin membership. Kuota dipotong saat jam bermain. Aturan: ${series.id}`,
            },
          }),
        )
        await tx.bookingDetail.createMany({
          data: valid.map((slot) => ({
            bookingId: booking.id,
            slotId: slot.id,
            courtId: slot.courtId,
            price: slot.price,
            discountPrice:
              slot.discountPrice && slot.discountPrice > 0
                ? slot.discountPrice
                : slot.price,
          })),
        })
        await tx.invoice.create({
          data: {
            branchId: series.branchId,
            userId: series.userId,
            bookingId: booking.id,
            number: await generateInvoiceNumber(),
            subtotal: 0,
            total: 0,
            status: 'PAID',
            paidAt: now,
            dueDate: valid.reduce(
              (earliest, slot) =>
                slot.startAt < earliest ? slot.startAt : earliest,
              valid[0]!.startAt,
            ),
          },
        })
        await tx.recurringBookingOccurrence.create({
          data: {
            branchId: series.branchId,
            seriesId: series.id,
            date: dateOnly(date),
            bookingId: booking.id,
          },
        })
      }
      if (horizon >= next)
        await tx.recurringBooking.update({
          where: { id: series.id },
          data: { processedThrough: dateOnly(horizon) },
        })
      if (endKey && endKey <= horizon)
        await tx.recurringBooking.update({
          where: { id: series.id },
          data: { isActive: false },
        })
    }),
  )
}

/** Invoked after rolling slot generation, both by reads and the minute worker. */
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
