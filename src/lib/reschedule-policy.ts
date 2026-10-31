export const MIN_RESCHEDULE_HOURS = 48

export function canRescheduleAt(startAt: Date, now = new Date()): boolean {
  return startAt.getTime() - now.getTime() >= MIN_RESCHEDULE_HOURS * 3_600_000
}
