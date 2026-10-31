import dayjs from '@/lib/club-time'
import { bookingWindowEnd } from '@/lib/rolling-booking-window'

export function courtBookingRange(
  courts: { bookingWindowMonths: number | null; slot: { startAt: Date }[] }[],
  now = new Date(),
) {
  const startDate = dayjs(now).format('YYYY-MM-DD')
  const endDate = courts.reduce((latest, court) => {
    const date = court.bookingWindowMonths
      ? dayjs(bookingWindowEnd(court.bookingWindowMonths, now)).format(
          'YYYY-MM-DD',
        )
      : court.slot[0]
        ? dayjs(court.slot[0].startAt).format('YYYY-MM-DD')
        : startDate
    return date > latest ? date : latest
  }, startDate)
  return {
    startDate,
    endDate,
    months: Math.max(0, ...courts.map((c) => c.bookingWindowMonths ?? 0)),
  }
}
