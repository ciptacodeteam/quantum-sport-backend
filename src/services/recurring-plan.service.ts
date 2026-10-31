import type { Court, Prisma, MembershipType } from '@prisma/client'
import dayjs from '@/lib/club-time'
import { BadRequestException } from '@/exceptions'
import { bookableCourtWhere } from '@/lib/court-branch-policy'
import {
  buildRollingCourtSlots,
  rollingCourtPricingSchema,
  bookingWindowEnd,
} from '@/lib/rolling-booking-window'
import { matchesRollingSlotRule } from '@/lib/rolling-slot-rule'
import {
  matchingDates,
  type RecurringBookingInput,
  type RecurringTemplate,
} from '@/lib/recurring-booking'
import { isSlotAllowedForMembershipType } from '@/lib/membership-hours'
import { resolveTariffPeriod, tariffBand } from '@/lib/tariff-period'
import { getTariffPeriods } from './tariff-policy.service'

type Tx = Prisma.TransactionClient
export type PlannedSlot = {
  id?: string
  courtId: string
  branchId: string
  startAt: Date
  endAt: Date
  price: number
  discountPrice: number
}
export function recurringEnd(
  input: Pick<
    RecurringBookingInput,
    'mode' | 'months' | 'startDate' | 'endDate'
  >,
  courts: Pick<Court, 'bookingWindowMonths'>[],
  now: Date,
) {
  if (input.mode === 'DATES') return input.endDate!
  if (input.mode === 'MONTHS')
    return dayjs(input.startDate)
      .add(input.months!, 'month')
      .format('YYYY-MM-DD')
  return courts
    .map((c) =>
      dayjs(bookingWindowEnd(c.bookingWindowMonths!, now)).format('YYYY-MM-DD'),
    )
    .sort()[0]!
}
export async function recurringSource(
  tx: Tx,
  input: RecurringBookingInput,
  now = new Date(),
) {
  const ids = [...new Set(input.sourceSlotIds)]
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
      (s) =>
        !s.court?.bookingWindowMonths ||
        dayjs(s.startAt).format('YYYY-MM-DD') !== input.startDate ||
        s.startAt <= now,
    )
  )
    throw new BadRequestException(
      'Pilih jadwal awal mendatang pada satu tanggal dan lapangan dengan pengaturan jadwal otomatis aktif.',
    )
  if (new Set(source.map((s) => s.branchId)).size !== 1)
    throw new BadRequestException('Pilih lapangan dalam satu cabang.')
  const courts = [
    ...new Map(source.map((s) => [s.courtId!, s.court!])).values(),
  ]
  const templates = source.map((s) => ({
    courtId: s.courtId!,
    courtName: s.court!.name,
    time: dayjs(s.startAt).format('HH:mm'),
    durationMinutes: dayjs(s.endAt).diff(dayjs(s.startAt), 'minute'),
  }))
  const horizon = recurringEnd(input, courts, now)
  if (
    input.startDate < dayjs(now).format('YYYY-MM-DD') ||
    horizon < input.startDate ||
    input.previewThrough > horizon ||
    input.previewThrough < input.startDate
  )
    throw new BadRequestException(
      'Rentang booking berubah. Periksa ulang jadwal rutin.',
    )
  return { source, courts, templates, horizon, branchId: source[0].branchId }
}
/** Read-only preview, including unpublished dates. Never publishes or holds a slot. */
export async function planRecurringSessions(
  tx: Tx,
  courts: Court[],
  templates: RecurringTemplate[],
  start: string,
  end: string,
  weekdays: number[],
  now: Date,
  membershipType?: MembershipType,
) {
  const branchId = courts[0].branchId
  const rules = await getTariffPeriods(tx, branchId)
  const existing = await tx.slot.findMany({
    where: {
      branchId,
      type: 'COURT',
      courtId: { in: courts.map((c) => c.id) },
      startAt: { lt: dayjs(end).add(1, 'day').startOf('day').toDate() },
      endAt: { gt: dayjs(start).startOf('day').toDate() },
    },
    include: {
      bookingDetails: {
        where: { booking: { status: { not: 'CANCELLED' } } },
        select: { id: true },
        take: 1,
      },
    },
  })
  const candidates = new Map<string, PlannedSlot>()
  for (const court of courts) {
    const config = rollingCourtPricingSchema.safeParse({
      ...(court.rollingPricing as object),
      courtId: court.id,
      months: court.bookingWindowMonths,
    })
    if (!config.success) {
      // Legacy rules may have published manual slots without rolling price
      // metadata. Keep those reservations usable, but never invent new hours.
      for (const slot of existing.filter(
        (slot) =>
          slot.courtId === court.id &&
          slot.startAt > now &&
          !slot.scheduleClosed,
      )) {
        if (
          !tariffBand(
            slot.startAt,
            resolveTariffPeriod(rules, slot.startAt, branchId, court.sport),
            slot.endAt,
          )
        )
          continue
        candidates.set(`${court.id}|${+slot.startAt}`, {
          id: slot.id,
          courtId: court.id,
          branchId,
          startAt: slot.startAt,
          endAt: slot.endAt,
          price: slot.price,
          discountPrice: slot.discountPrice,
        })
      }
      continue
    }
    for (const slot of buildRollingCourtSlots(
      { ...config.data, sport: court.sport },
      branchId,
      dayjs(start).toDate(),
      now,
      rules,
      dayjs(end).endOf('day').toDate(),
    )) {
      if (
        config.data.bulkRules?.some(
          (rule) =>
            rule.kind === 'disable' &&
            matchesRollingSlotRule(slot.startAt, rule),
        )
      )
        continue
      candidates.set(`${court.id}|${+slot.startAt}`, {
        courtId: court.id,
        branchId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        price: slot.price ?? 0,
        discountPrice: slot.discountPrice ?? 0,
      })
    }
  }
  return matchingDates(start, end, weekdays).map((date) => {
    const slots: PlannedSlot[] = [],
      conflicts: string[] = []
    for (const template of templates) {
      const startAt = dayjs(`${date} ${template.time}`).toDate(),
        endAt = new Date(+startAt + template.durationMinutes * 60000)
      const draft = candidates.get(`${template.courtId}|${+startAt}`)
      const found = existing.find(
        (s) => s.courtId === template.courtId && +s.startAt === +startAt,
      )
      const overlap = existing.some(
        (s) =>
          s.courtId === template.courtId &&
          +s.startAt !== +startAt &&
          s.startAt < endAt &&
          s.endAt > startAt,
      )
      const court = courts.find((c) => c.id === template.courtId)!
      if (
        !draft ||
        +draft.endAt !== +endAt ||
        overlap ||
        (found &&
          (!found.isAvailable ||
            found.scheduleClosed ||
            found.bookingDetails.length ||
            +found.endAt !== +endAt)) ||
        (membershipType &&
          !isSlotAllowedForMembershipType(membershipType, startAt, {
            rules,
            branchId,
            sport: court.sport,
            endAt,
          }))
      ) {
        conflicts.push(
          `${template.courtName} ${template.time}: jadwal ditutup, bentrok, atau tidak sesuai jam Value Pack.`,
        )
      } else
        slots.push(
          found
            ? {
                id: found.id,
                courtId: template.courtId,
                branchId,
                startAt: found.startAt,
                endAt: found.endAt,
                price: found.price,
                discountPrice: found.discountPrice,
              }
            : draft,
        )
    }
    return { date, slots: conflicts.length ? [] : slots, conflicts }
  })
}
