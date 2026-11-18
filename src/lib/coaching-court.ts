type TimedSlot = { startAt: Date; endAt: Date }

// Older checkouts did not persist courtSlotId. Only infer a court when the
// booking contains exactly one court slot for this service hour.
export function findCoachingCourt<T extends TimedSlot>(
  service: TimedSlot,
  courts: readonly T[],
): T | undefined {
  const matches = courts.filter(
    (court) =>
      +court.startAt === +service.startAt && +court.endAt === +service.endAt,
  )
  return matches.length === 1 ? matches[0] : undefined
}
