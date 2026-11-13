import { z } from 'zod'
const marker = '[COURT_RESCHEDULE] '
const schedule = z.object({
  court: z.string(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
})
const auditSchema = z.object({
  at: z.string().datetime(),
  actorId: z.string(),
  bookingId: z.string(),
  from: schedule,
  to: schedule,
})
export type BookingRescheduleAudit = z.infer<typeof auditSchema>
export function appendRescheduleAudit(
  note: string | null | undefined,
  audit: BookingRescheduleAudit,
) {
  return [note, marker + JSON.stringify(auditSchema.parse(audit))]
    .filter(Boolean)
    .join('\n')
}
export function lastRescheduleAudit(
  note: string | null | undefined,
): BookingRescheduleAudit | null {
  for (const line of (note ?? '').split('\n').reverse()) {
    if (!line.startsWith(marker)) continue
    try {
      const result = auditSchema.safeParse(
        JSON.parse(line.slice(marker.length)),
      )
      if (result.success) return result.data
    } catch {
      /* Older or manually edited notes are not reschedule events. */
    }
  }
  return null
}

const courtChangeSchema = auditSchema.extend({
  from: schedule.extend({ slotId: z.string() }),
  to: schedule.extend({ slotId: z.string() }),
})
export function appendCourtChangeAudit(
  note: string | null | undefined,
  audit: z.infer<typeof courtChangeSchema>,
) {
  return [note, '[COURT_CHANGE] ' + JSON.stringify(courtChangeSchema.parse(audit))]
    .filter(Boolean)
    .join('\n')
}
