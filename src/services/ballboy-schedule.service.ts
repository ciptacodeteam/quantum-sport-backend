import { ensureServiceSchedules } from './service-schedule-maintenance.service'

export function ensureBallboySchedules(now = new Date()) {
  return ensureServiceSchedules('BALLBOY', now)
}
