import { courtBookingCutoff } from './booking-time-policy'
import { clubNowAsWallDate } from './club-time'

export const MIN_RESCHEDULE_HOURS = 48

export function canRescheduleAt(
  startAt: Date,
  now = new Date(),
  role?: string,
): boolean {
  if (!Number.isFinite(startAt.getTime())) return false
  if (role === 'SUPER_ADMIN')
    return startAt.getTime() > courtBookingCutoff(now).getTime()
  return (
    startAt.getTime() - clubNowAsWallDate(now).getTime() >=
    MIN_RESCHEDULE_HOURS * 3_600_000
  )
}
