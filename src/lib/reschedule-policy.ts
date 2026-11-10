export const MIN_RESCHEDULE_HOURS = 48

export function canRescheduleAt(
  startAt: Date,
  now = new Date(),
  role?: string,
): boolean {
  if (!Number.isFinite(startAt.getTime())) return false
  if (role === 'SUPER_ADMIN') return true
  return startAt.getTime() - now.getTime() >= MIN_RESCHEDULE_HOURS * 3_600_000
}
