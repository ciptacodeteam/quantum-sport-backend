import { clubNowAsWallDate } from './club-time'

export const PAYMENT_WINDOW_MINUTES = 10
export const COURT_BOOKING_GRACE_MINUTES = 30

export function paymentDeadline(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + PAYMENT_WINDOW_MINUTES * 60_000)
}

// Compare against Prisma wall-stored slot timestamps, not UTC instants.
// Strict comparison: a 15:00 slot closes at exactly 15:30 WIB.
export function courtBookingCutoff(now: Date): Date {
  return new Date(
    clubNowAsWallDate(now).getTime() - COURT_BOOKING_GRACE_MINUTES * 60_000,
  )
}
