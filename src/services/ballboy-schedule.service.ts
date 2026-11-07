import { branchContext } from '@/lib/branch-context'
import dayjs from '@/lib/club-time'
import { ensureRollingServiceSchedules } from './rolling-service-schedule.service'
import { ensureRollingCourtSchedules } from './rolling-court-schedule.service'

// Cache schedule maintenance only. Availability and booking conflicts are always read fresh.
const maintenance = new Map<
  string,
  { completedAt?: number; pending?: Promise<void> }
>()
export async function ensureBallboySchedules(now = new Date()) {
  const context = branchContext.getStore()
  const key = JSON.stringify([
    context?.branchId,
    context?.isSuperAdmin,
    dayjs(now).format('YYYY-MM-DD'),
  ])
  const existing = maintenance.get(key)
  if (existing?.pending) return existing.pending
  if (
    existing?.completedAt !== undefined &&
    +now - existing.completedAt < 60000
  )
    return
  // Discard previous days while keeping each branch isolated.
  for (const [entryKey, entry] of maintenance) {
    if (
      !entry.pending &&
      entry.completedAt !== undefined &&
      +now - entry.completedAt >= 60000
    )
      maintenance.delete(entryKey)
  }
  const entry: { completedAt?: number; pending?: Promise<void> } = {}
  entry.pending = ensureRollingCourtSchedules(undefined, now, {
    includeServices: false,
  })
    .then(() => ensureRollingServiceSchedules(now, 'BALLBOY'))
    .then(() => {
      entry.completedAt = +now
    })
    .catch((error) => {
      maintenance.delete(key)
      throw error
    })
    .finally(() => {
      entry.pending = undefined
    })
  maintenance.set(key, entry)
  await entry.pending
}
