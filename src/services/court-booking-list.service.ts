import { z } from 'zod'
import { db } from '@/lib/prisma'
import {
  bookingCheckoutTypes,
  bookingCheckoutWhere,
} from '@/lib/booking-checkout'
import {
  bookingDateRangeFields,
  bookingDateRangeError,
  validBookingDateRange,
  courtPlayingDateWhere,
  type BookingDateRange,
} from '@/lib/booking-date-filter'
import type { Prisma, CourtSport } from '@prisma/client'

export const courtBookingSortFields = [
  'createdAt',
  'invoice',
  'customer',
  'status',
  'holdExpiresAt',
] as const
export type CourtBookingSort = (typeof courtBookingSortFields)[number]
export type CourtBookingSearch = {
  search?: string
  sortBy?: CourtBookingSort
  order?: 'asc' | 'desc'
}
export const courtBookingListSchema = z
  .object({
    ...bookingDateRangeFields,
    courtSport: z.enum(['PADEL', 'TENNIS']).default('PADEL'),
    checkoutType: z.enum(bookingCheckoutTypes).optional(),
    search: z.string().trim().max(200).optional(),
    sortBy: z.enum(courtBookingSortFields).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  })
  .refine(validBookingDateRange, bookingDateRangeError)

export function courtBookingSearchWhere(
  search?: string,
): Prisma.BookingWhereInput {
  if (!search?.trim()) return {}
  const contains = { contains: search.trim(), mode: 'insensitive' as const }
  return {
    OR: [
      { user: { name: contains } },
      { user: { phone: contains } },
      { user: { email: contains } },
      { invoice: { number: contains } },
    ],
  }
}
export function courtBookingOrder(
  query: CourtBookingSearch,
): Prisma.BookingOrderByWithRelationInput[] {
  const direction = query.order ?? 'desc'
  const fields: Record<
    CourtBookingSort,
    Prisma.BookingOrderByWithRelationInput
  > = {
    createdAt: { createdAt: direction },
    invoice: { invoice: { number: direction } },
    customer: { user: { name: direction } },
    status: { status: direction },
    holdExpiresAt: { holdExpiresAt: { sort: direction, nulls: 'last' } },
  }
  return [fields[query.sortBy ?? 'createdAt'], { id: direction }]
}
export function courtBookingListWhere(
  query: BookingDateRange & {
    courtSport: CourtSport
    checkoutType?: (typeof bookingCheckoutTypes)[number]
    search?: string
  },
): Prisma.BookingWhereInput {
  return {
    AND: [
      { details: { some: { court: { sport: query.courtSport } } } },
      bookingCheckoutWhere(query.checkoutType),
      courtPlayingDateWhere(query, query.courtSport),
      courtBookingSearchWhere(query.search),
    ],
  }
}
export async function getCourtBookingList(
  query: z.infer<typeof courtBookingListSchema>,
) {
  const where = courtBookingListWhere(query)
  // Both queries are scoped by the same branch-aware client and filters.
  const [items, total] = await Promise.all([
    db.booking.findMany({
      where,
      orderBy: courtBookingOrder(query),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        cashier: { select: { id: true, name: true } },
        details: {
          select: {
            id: true,
            courtId: true,
            slotId: true,
            price: true,
            discountPrice: true,
            court: { select: { id: true, name: true, sport: true } },
            slot: { select: { id: true, startAt: true, endAt: true } },
          },
        },
        invoice: {
          select: { id: true, number: true, total: true, status: true },
        },
      },
    }),
    db.booking.count({ where }),
  ])
  return { items, total, page: query.page, limit: query.limit }
}
