import { expect, it } from 'vitest'
import {
  appendRescheduleAudit,
  lastRescheduleAudit,
} from './booking-reschedule-audit'
const event = {
  at: '2040-01-01T00:00:00.000Z',
  actorId: 'admin',
  bookingId: 'court',
  from: {
    court: 'Court 1',
    startAt: '2040-01-05T09:00:00+07:00',
    endAt: '2040-01-05T10:00:00+07:00',
  },
  to: {
    court: 'Court 2',
    startAt: '2040-01-08T10:00:00+07:00',
    endAt: '2040-01-08T11:00:00+07:00',
  },
}
it('preserves manual notes and reads the most recent structured reschedule', () => {
  const first = appendRescheduleAudit('Catatan awal', event)
  const next = { ...event, at: '2040-01-02T00:00:00.000Z' }
  const note = appendRescheduleAudit(first, next)
  expect(note).toContain('Catatan awal')
  expect(lastRescheduleAudit(note)).toEqual(next)
  expect(lastRescheduleAudit(note + '\n[COURT_RESCHEDULE] bad JSON')).toEqual(
    next,
  )
  expect(lastRescheduleAudit('Catatan manual')).toBeNull()
})
