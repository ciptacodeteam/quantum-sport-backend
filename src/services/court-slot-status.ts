export function getCourtSlotStatus(isAvailable: boolean, bookingStatuses: string[]) {
  if (bookingStatuses.includes('CONFIRMED')) return 'BOOKED'
  if (bookingStatuses.includes('HOLD')) return 'ON_HOLD'
  return isAvailable ? 'AVAILABLE' : 'UNAVAILABLE'
}
