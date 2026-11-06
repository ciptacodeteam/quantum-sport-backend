/** Prices a continuous sequence per coach; gaps and coach changes start a new session. */
export function priceCoachSessions<
  T extends {
    id: string
    staffId: string | null
    startAt: Date
    endAt: Date
    price: number
    additionalHourPrice?: number | null
  },
>(slots: T[]) {
  const result = new Map<string, number>()
  const ends = new Map<string, number>()
  for (const slot of [...slots].sort((a, b) => +a.startAt - +b.startAt)) {
    const consecutive =
      !!slot.staffId &&
      ends.get(slot.staffId) === +slot.startAt &&
      +slot.endAt - +slot.startAt === 3600000
    result.set(
      slot.id,
      consecutive ? (slot.additionalHourPrice ?? slot.price) : slot.price,
    )
    if (slot.staffId) ends.set(slot.staffId, +slot.endAt)
  }
  return result
}
