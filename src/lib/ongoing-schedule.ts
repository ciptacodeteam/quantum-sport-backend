type ScheduleSlot = { startAt: Date; endAt: Date }

/** Use the full booking range so an earlier slot ending does not finish a multi-slot booking. */
export function getOngoingSchedule(slots: ScheduleSlot[], now: Date) {
  if (!slots.length) return null
  const startAt = new Date(
    Math.min(...slots.map((slot) => slot.startAt.getTime())),
  )
  const endAt = new Date(Math.max(...slots.map((slot) => slot.endAt.getTime())))
  if (endAt <= now) return null
  return {
    startAt,
    endAt,
    status: startAt > now ? ('upcoming' as const) : ('ongoing' as const),
  }
}
