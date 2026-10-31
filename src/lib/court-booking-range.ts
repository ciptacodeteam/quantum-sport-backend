import dayjs, { clubWallDateString } from '@/lib/club-time'
import { bookingWindowEnd } from '@/lib/rolling-booking-window'

export function courtBookingRange(
  courts: { bookingWindowMonths: number | null; slot: { startAt: Date }[] }[],
  now = new Date(),
) {
  const startDate = dayjs(now).format('YYYY-MM-DD')
  const endDate = courts.reduce((latest, court) => {
    const date = court.bookingWindowMonths
      ? clubWallDateString(bookingWindowEnd(court.bookingWindowMonths, now))
      : court.slot[0]
        ? clubWallDateString(court.slot[0].startAt)
        : startDate
    return date > latest ? date : latest
  }, startDate)
  return {
    startDate,
    endDate,
    months: Math.max(0, ...courts.map((c) => c.bookingWindowMonths ?? 0)),
  }
}
