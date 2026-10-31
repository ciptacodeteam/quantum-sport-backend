export const PAYMENT_WINDOW_MINUTES = 10
export const COURT_BOOKING_GRACE_MINUTES = 15

export function paymentDeadline(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + PAYMENT_WINDOW_MINUTES * 60_000)
}

// Strict comparison: a 15:00 slot closes at exactly 15:15.
export function courtBookingCutoff(now: Date): Date {
  return new Date(now.getTime() - COURT_BOOKING_GRACE_MINUTES * 60_000)
}
