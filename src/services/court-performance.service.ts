import { db } from '@/lib/prisma'
import clubTime from '@/lib/club-time'
import { bookingWindowEnd } from '@/lib/rolling-booking-window'
import { resolveTariffPeriod, tariffBand } from '@/lib/tariff-period'
import { getTariffPeriods } from './tariff-policy.service'
import type { Prisma } from '@prisma/client'

const bookingInclude = {
  user: { select: { name: true } },
  invoice: true,
  membershipUser: { include: { membership: true, invoice: true } },
  recurringOccurrences: { select: { id: true } },
  details: { include: { slot: { include: { court: true } } } },
} satisfies Prisma.BookingInclude
export type PerformanceBooking = Prisma.BookingGetPayload<{
  include: typeof bookingInclude
}>
type Interval = { startAt: Date; endAt: Date }
export function intervalHours(intervals: Interval[], start: Date, end: Date) {
  const ranges = intervals
    .map((i) => [Math.max(+i.startAt, +start), Math.min(+i.endAt, +end)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])
  let total = 0,
    left = 0,
    right = 0
  for (const [a, b] of ranges) {
    if (a > right) {
      total += right - left
      left = a
      right = b
    } else right = Math.max(right, b)
  }
  return (total + right - left) / 3_600_000
}
export function courtPayment(
  booking: Pick<
    PerformanceBooking,
    | 'membershipUserId'
    | 'courtDiscountPrice'
    | 'totalPrice'
    | 'promoDiscountAmount'
    | 'invoice'
  >,
) {
  if (booking.invoice?.status !== 'PAID') return 0
  // Court total already contains bundle discounts. Allocate order-level promos
  // proportionally; exclude processing fees and add-ons from court revenue.
  const beforePromo = booking.totalPrice + booking.promoDiscountAmount
  return (
    Math.max(0, booking.courtDiscountPrice) *
    (beforePromo > 0
      ? Math.max(0, 1 - booking.promoDiscountAmount / beforePromo)
      : 0)
  )
}
export function membershipDetail(
  booking: PerformanceBooking,
  detail: PerformanceBooking['details'][number],
) {
  return (
    !!booking.membershipUserId &&
    (detail.discountPrice === 0 ||
      booking.courtDiscountPrice === 0 ||
      booking.recurringOccurrences.length > 0)
  )
}
export async function getCourtPerformance(
  startDate: string,
  endDate: string,
  courtId?: string,
) {
  const start = clubTime(startDate).startOf('day').toDate()
  const end = clubTime(endDate).add(1, 'day').startOf('day').toDate()
  const window = { startAt: { lt: end }, endAt: { gt: start } }
  const [courts, slots, bookings, rules, packages] = await Promise.all([
    db.court.findMany({
      orderBy: { name: 'asc' },
      include: { branch: { select: { name: true } } },
    }),
    db.slot.findMany({
      where: { type: 'COURT', ...(courtId ? { courtId } : {}), ...window },
      select: {
        id: true,
        courtId: true,
        startAt: true,
        endAt: true,
        isAvailable: true,
        scheduleClosed: true,
        bookingDetails: {
          where: { booking: { status: 'HOLD' } },
          select: { id: true },
          take: 1,
        },
      },
    }),
    db.booking.findMany({
      where: {
        status: 'CONFIRMED',
        details: {
          some: { slot: { ...window, ...(courtId ? { courtId } : {}) } },
        },
      },
      include: bookingInclude,
    }),
    getTariffPeriods(),
    db.membership.findMany({ orderBy: { sequence: 'asc' } }),
  ])
  const now = new Date()
  const rows = bookings
    .flatMap((booking) => {
      const regularDetails = booking.details.filter(
        (d) => !membershipDetail(booking, d),
      )
      const weightTotal = regularDetails.reduce(
        (sum, d) => sum + Math.max(0, d.discountPrice || d.price),
        0,
      )
      const netCourt = courtPayment(booking)
      return booking.details.flatMap((detail) => {
        const slot = detail.slot,
          court = slot.court
        if (
          !court ||
          (courtId && court.id !== courtId) ||
          slot.startAt >= end ||
          slot.endAt <= start
        )
          return []
        const hours = intervalHours([slot], start, end)
        const pastHours = intervalHours(
          [slot],
          start,
          new Date(Math.min(+end, +now)),
        )
        const band = tariffBand(
          slot.startAt,
          resolveTariffPeriod(rules, slot.startAt, court.branchId, court.sport),
          slot.endAt,
        )
        const isMembership = membershipDetail(booking, detail)
        const pack = booking.membershipUser
        // Paid purchase price, never the mutable catalogue price. Unknown sales
        // remain unvalued and are surfaced explicitly instead of inventing revenue.
        const sale = pack?.invoice
        const rate =
          sale?.status === 'PAID' && pack && pack.membership.sessions > 0
            ? Math.max(0, sale.total - sale.processingFee) /
              pack.membership.sessions
            : null
        const fullHours = (+slot.endAt - +slot.startAt) / 3_600_000
        const paid = isMembership
          ? 0
          : (netCourt *
              (weightTotal > 0
                ? Math.max(0, detail.discountPrice || detail.price) /
                  weightTotal
                : 0) *
              hours) /
            fullHours
        const allocation = isMembership && rate !== null ? rate * hours : 0
        const complimentary =
          !isMembership && booking.invoice?.status === 'PAID' && netCourt === 0
        const categoryId = isMembership
          ? `membership:${pack?.membershipId ?? 'unknown'}`
          : complimentary
            ? 'complimentary'
            : `regular:${band ?? 'other'}`
        return [
          {
            id: detail.id,
            bookingId: booking.id,
            invoiceId: booking.invoice?.id ?? null,
            invoiceNumber: booking.invoice?.number ?? null,
            customer: booking.user.name,
            courtId: court.id,
            court: court.name,
            branchId: court.branchId,
            branch:
              courts.find((c) => c.id === court.id)?.branch?.name ??
              court.branchId,
            sport: court.sport,
            startAt: slot.startAt.toISOString(),
            endAt: slot.endAt.toISOString(),
            createdAt: booking.createdAt.toISOString(),
            categoryId,
            category: isMembership
              ? (pack?.membership.name ?? 'Value Pack tidak teridentifikasi')
              : complimentary
                ? 'Complimentary'
                : band === 'peakHour'
                  ? 'Non-membership · Peak Hour'
                  : band === 'happyHour'
                    ? 'Non-membership · Happy Hour'
                    : 'Non-membership · Di luar jam tarif',
            band: band ?? 'other',
            hours,
            pastHours,
            upcomingHours: hours - pastHours,
            normalPrice: (detail.price * hours) / fullHours,
            paidRevenue: paid,
            membershipAllocation: allocation,
            revenue: paid + allocation,
            realizedRevenue: ((paid + allocation) * pastHours) / hours,
            unvaluedMembershipHours: isMembership && rate === null ? hours : 0,
          },
        ]
      })
    })
    .sort(
      (a, b) =>
        a.startAt.localeCompare(b.startAt) || a.court.localeCompare(b.court),
    )
  const bookedIds = new Set(
    bookings.flatMap((b) => b.details.map((d) => d.slotId)),
  )
  const sum = (items: typeof rows) => ({
    hours: items.reduce((s, r) => s + r.hours, 0),
    pastHours: items.reduce((s, r) => s + r.pastHours, 0),
    upcomingHours: items.reduce((s, r) => s + r.upcomingHours, 0),
    paidRevenue: items.reduce((s, r) => s + r.paidRevenue, 0),
    membershipAllocation: items.reduce((s, r) => s + r.membershipAllocation, 0),
    revenue: items.reduce((s, r) => s + r.revenue, 0),
    realizedRevenue: items.reduce((s, r) => s + r.realizedRevenue, 0),
    bookings: new Set(items.map((r) => r.bookingId)).size,
    unvaluedMembershipHours: items.reduce(
      (s, r) => s + r.unvaluedMembershipHours,
      0,
    ),
  })
  const capacityFor = (id: string) => {
    const court = courts.find((c) => c.id === id)!
    const horizon = court.bookingWindowMonths
      ? bookingWindowEnd(court.bookingWindowMonths, now)
      : null
    return intervalHours(
      slots.filter(
        (s) =>
          s.courtId === id &&
          (bookedIds.has(s.id) ||
            (!s.scheduleClosed &&
              (s.isAvailable || s.bookingDetails?.length > 0) &&
              (s.startAt <= now ||
                (court.isActive && (!horizon || s.startAt <= horizon))))),
      ),
      start,
      end,
    )
  }
  const courtSummary = courts
    .filter((c) => !courtId || c.id === courtId)
    .map((c) => {
      const selected = rows.filter((r) => r.courtId === c.id),
        capacityHours = capacityFor(c.id)
      const occupiedHours = intervalHours(
        selected.map((r) => ({
          startAt: new Date(r.startAt),
          endAt: new Date(r.endAt),
        })),
        start,
        end,
      )
      return {
        id: c.id,
        name: c.name,
        sport: c.sport,
        branchId: c.branchId,
        branch: c.branch?.name ?? c.branchId,
        ...sum(selected),
        capacityHours,
        occupiedHours,
        occupancy:
          capacityHours > 0 ? (occupiedHours / capacityHours) * 100 : 0,
      }
    })
  const categories = new Map<string, string>([
    ['regular:happyHour', 'Non-membership · Happy Hour'],
    ['regular:peakHour', 'Non-membership · Peak Hour'],
    ...packages.map((p) => [`membership:${p.id}`, p.name] as [string, string]),
    ['complimentary', 'Complimentary'],
  ])
  rows.forEach((r) => categories.set(r.categoryId, r.category))
  const capacityHours = courtSummary.reduce((s, c) => s + c.capacityHours, 0)
  const occupiedHours = courtSummary.reduce((s, c) => s + c.occupiedHours, 0)
  const branchSummary = [...new Set(courtSummary.map((c) => c.branchId))].map(
    (branchId) => {
      const selected = courtSummary.filter((c) => c.branchId === branchId)
      const branchCapacity = selected.reduce((s, c) => s + c.capacityHours, 0)
      const branchOccupied = selected.reduce((s, c) => s + c.occupiedHours, 0)
      const totals = sum(rows.filter((r) => r.branchId === branchId))
      const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
      return {
        id: branchId,
        name: selected[0].branch,
        courts: selected.length,
        ...totals,
        capacityHours: branchCapacity,
        occupiedHours: branchOccupied,
        occupancy:
          branchCapacity > 0 ? (branchOccupied / branchCapacity) * 100 : 0,
        revenueShare:
          totalRevenue > 0 ? (totals.revenue / totalRevenue) * 100 : 0,
      }
    },
  )
  return {
    startDate,
    endDate,
    generatedAt: now.toISOString(),
    courts: courts.map((c) => ({
      id: c.id,
      name: c.name,
      sport: c.sport,
      branchId: c.branchId,
      branch: c.branch?.name ?? c.branchId,
    })),
    summary: {
      ...sum(rows),
      capacityHours,
      occupiedHours,
      occupancy: capacityHours > 0 ? (occupiedHours / capacityHours) * 100 : 0,
      membershipHours: rows
        .filter((r) => r.categoryId.startsWith('membership:'))
        .reduce((s, r) => s + r.hours, 0),
      nonMembershipHours: rows
        .filter((r) => r.categoryId.startsWith('regular:'))
        .reduce((s, r) => s + r.hours, 0),
    },
    courtSummary,
    branchSummary,
    categories: [...categories].map(([id, name]) => ({
      id,
      name,
      ...sum(rows.filter((r) => r.categoryId === id)),
    })),
    rows,
  }
}
