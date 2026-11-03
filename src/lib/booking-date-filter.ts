import { z } from 'zod'
import { toClubWallDate } from './club-time'
import type { CourtSport } from '@prisma/client'

export const bookingDateRangeFields = {
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
}
export type BookingDateRange = { dateFrom?: string; dateTo?: string }
export const validBookingDateRange = (range: BookingDateRange) =>
  !range.dateFrom || !range.dateTo || range.dateFrom <= range.dateTo
export const bookingDateRangeError = {
  message: 'Tanggal akhir harus sama atau setelah tanggal mulai.',
  path: ['dateTo'],
}

/** Slot timestamps carry Jakarta wall components; include the complete last day. */
export function playingDateRange(range: BookingDateRange) {
  if (!range.dateFrom && !range.dateTo) return undefined
  return {
    ...(range.dateFrom
      ? { gte: toClubWallDate(`${range.dateFrom} 00:00:00`) }
      : {}),
    ...(range.dateTo
      ? { lt: new Date(+toClubWallDate(`${range.dateTo} 00:00:00`) + 86400000) }
      : {}),
  }
}
export function courtPlayingDateWhere(
  range: BookingDateRange,
  sport?: CourtSport,
) {
  const startAt = playingDateRange(range)
  return startAt
    ? {
        details: {
          some: { slot: { startAt }, ...(sport ? { court: { sport } } : {}) },
        },
      }
    : {}
}
/** Purchase creation timestamps are real instants, unlike slot wall timestamps. */
export function purchaseDateWhere(range: BookingDateRange) {
  if (!range.dateFrom && !range.dateTo) return {}
  return {
    createdAt: {
      ...(range.dateFrom
        ? { gte: new Date(`${range.dateFrom}T00:00:00+07:00`) }
        : {}),
      ...(range.dateTo
        ? {
            lt: new Date(
              +new Date(`${range.dateTo}T00:00:00+07:00`) + 86400000,
            ),
          }
        : {}),
    },
  }
}
