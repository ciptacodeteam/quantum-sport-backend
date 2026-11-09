import { db } from '@/lib/prisma'
import { formatClubWallClock } from '@/lib/club-time'
import type { Prisma } from '@prisma/client'

export const serviceIncomeInclude = {
  branch: { select: { name: true } },
  user: { select: { name: true } },
  booking: {
    include: {
      coaches: {
        include: {
          slot: { include: { staff: { select: { id: true, name: true } } } },
        },
      },
      ballboys: {
        include: {
          slot: { include: { staff: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.InvoiceInclude

type IncomeInvoice = Prisma.InvoiceGetPayload<{
  include: typeof serviceIncomeInclude
}>
export type ServiceIncomeFilters = {
  clubId?: string
  staffId?: string
  service?: 'COACH' | 'BALLBOY'
}
export type ServiceIncomeRow = {
  id: string
  invoiceId: string
  invoiceNumber: string
  bookingId: string
  customerName: string
  branchId: string
  branchName: string
  paidAt: Date
  service: 'COACH' | 'BALLBOY'
  staffId: string | null
  staffName: string
  clubId: string | null
  clubName: string
  startAt: string
  endAt: string
  hours: number
  servicePrice: number
  discount: number
  amount: number
}

// Allocate only the actual payment excluding fees. Include the non-service
// remainder and cancelled lines in rounding, so neither discounts nor a cancelled
// coach's share are transferred to another club. All amounts remain whole rupiah.
export function allocateServicePayment(
  prices: number[],
  beforePromo: number,
  paid: number,
) {
  const total = Math.max(
    beforePromo,
    prices.reduce((sum, price) => sum + price, 0),
  )
  if (total <= 0) return prices.map(() => 0)
  const budget = Math.max(0, Math.min(paid, total))
  const buckets = [
    ...prices,
    total - prices.reduce((sum, price) => sum + price, 0),
  ]
  const shares = buckets.map((price, index) => ({
    index,
    value: Math.floor((price * budget) / total),
    fraction: (price * budget) % total,
  }))
  const remaining = budget - shares.reduce((sum, share) => sum + share.value, 0)
  const order = [...shares].sort(
    (a, b) => b.fraction - a.fraction || a.index - b.index,
  )
  for (let i = 0; i < remaining; i++) order[i].value++
  return shares.slice(0, prices.length).map((share) => share.value)
}

export function buildServiceIncome(
  invoices: IncomeInvoice[],
  filters: ServiceIncomeFilters = {},
) {
  const allRows: ServiceIncomeRow[] = []
  for (const invoice of invoices) {
    const booking = invoice.booking
    if (
      invoice.status !== 'PAID' ||
      !invoice.paidAt ||
      !booking ||
      booking.status !== 'CONFIRMED' ||
      booking.purpose !== 'REGULAR'
    )
      continue
    const services = [
      ...booking.coaches.map((item) => ({
        ...item,
        service: 'COACH' as const,
        clubId: item.coachingGroupId,
        clubName: item.coachingGroupName,
      })),
      ...booking.ballboys.map((item) => ({
        ...item,
        service: 'BALLBOY' as const,
        clubId: null,
        clubName: null,
      })),
    ].sort((a, b) => a.id.localeCompare(b.id))
    const prices = services.map((item) => Math.max(0, item.price))
    const amounts = allocateServicePayment(
      prices,
      booking.totalPrice + booking.promoDiscountAmount,
      Math.max(0, invoice.total - invoice.processingFee),
    )
    services.forEach((item, index) => {
      if (item.status !== 'CONFIRMED' || amounts[index] <= 0) return
      // Keep settled prices in allocation so their share never moves to another club.
      if (item.service === 'COACH' && item.isClubSettled) return
      allRows.push({
        id: `${item.service}:${item.id}`,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        bookingId: booking.id,
        customerName: invoice.user.name,
        branchId: invoice.branchId,
        branchName: invoice.branch.name,
        paidAt: invoice.paidAt!,
        service: item.service,
        staffId: item.slot.staff?.id ?? null,
        staffName:
          item.slot.staff?.name ??
          (item.service === 'COACH'
            ? 'Coach tidak tersedia'
            : 'Ballboy tidak tersedia'),
        // Use the club captured on the booking, never today's coach membership.
        clubId:
          item.clubId ?? (item.clubName ? `archived:${item.clubName}` : null),
        clubName: item.clubName || 'Tanpa Club',
        startAt: formatClubWallClock(item.slot.startAt),
        endAt: formatClubWallClock(item.slot.endAt),
        hours: Math.max(0, (+item.slot.endAt - +item.slot.startAt) / 3600000),
        servicePrice: prices[index],
        discount: prices[index] - amounts[index],
        amount: amounts[index],
      })
    })
  }
  const rows = allRows.filter(
    (row) =>
      (!filters.clubId ||
        (filters.clubId === 'unassigned'
          ? !row.clubId
          : row.clubId === filters.clubId)) &&
      (!filters.staffId || row.staffId === filters.staffId) &&
      (!filters.service || row.service === filters.service),
  )
  const clubs = new Map<
    string,
    {
      id: string
      name: string
      coachAmount: number
      ballboyAmount: number
      totalAmount: number
      sessions: number
      hours: number
    }
  >()
  const staff = new Map<
    string,
    {
      id: string
      name: string
      service: 'COACH' | 'BALLBOY'
      clubName: string
      sessions: number
      hours: number
      amount: number
    }
  >()
  for (const row of rows) {
    const clubId = row.clubId ?? 'unassigned'
    const club = clubs.get(clubId) ?? {
      id: clubId,
      name: row.clubName,
      coachAmount: 0,
      ballboyAmount: 0,
      totalAmount: 0,
      sessions: 0,
      hours: 0,
    }
    club[row.service === 'COACH' ? 'coachAmount' : 'ballboyAmount'] +=
      row.amount
    club.totalAmount += row.amount
    club.sessions++
    club.hours += row.hours
    clubs.set(clubId, club)
    const staffKey = `${row.service}:${row.staffId ?? row.staffName}:${clubId}`
    const member = staff.get(staffKey) ?? {
      id: staffKey,
      name: row.staffName,
      service: row.service,
      clubName: row.clubName,
      sessions: 0,
      hours: 0,
      amount: 0,
    }
    member.sessions++
    member.hours += row.hours
    member.amount += row.amount
    staff.set(staffKey, member)
  }
  return {
    summary: {
      totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
      coachAmount: rows
        .filter((row) => row.service === 'COACH')
        .reduce((sum, row) => sum + row.amount, 0),
      ballboyAmount: rows
        .filter((row) => row.service === 'BALLBOY')
        .reduce((sum, row) => sum + row.amount, 0),
      unassignedAmount: rows
        .filter((row) => !row.clubId)
        .reduce((sum, row) => sum + row.amount, 0),
      invoiceCount: new Set(rows.map((row) => row.invoiceId)).size,
      sessions: rows.length,
      clubCount: [...clubs.keys()].filter((id) => id !== 'unassigned').length,
    },
    clubs: [...clubs.values()].sort(
      (a, b) => b.totalAmount - a.totalAmount || a.name.localeCompare(b.name),
    ),
    staff: [...staff.values()].sort(
      (a, b) => b.amount - a.amount || a.name.localeCompare(b.name),
    ),
    rows,
    options: {
      clubs: [
        ...new Map(
          allRows.map((row) => [
            row.clubId ?? 'unassigned',
            { id: row.clubId ?? 'unassigned', name: row.clubName },
          ]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
      staff: [
        ...new Map(
          allRows
            .filter((row) => row.staffId)
            .map((row) => [
              row.staffId!,
              { id: row.staffId!, name: row.staffName },
            ]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    },
  }
}

export async function getServiceIncome(
  startDate: Date,
  endDate: Date,
  filters: ServiceIncomeFilters = {},
) {
  const invoices = await db.invoice.findMany({
    where: {
      status: 'PAID',
      paidAt: { gte: startDate, lte: endDate },
      booking: {
        is: {
          status: 'CONFIRMED',
          purpose: 'REGULAR',
          OR: [{ coaches: { some: {} } }, { ballboys: { some: {} } }],
        },
      },
    },
    include: serviceIncomeInclude,
    orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
  })
  return {
    ...buildServiceIncome(invoices, filters),
    dateRange: { startDate, endDate },
  }
}
