import { expect, it } from 'vitest'
import { canRescheduleAt } from './reschedule-policy'

it.each(['CASHIER', 'ADMIN', undefined])(
  'enforces H-2 in WIB for %s, including across Jakarta midnight',
  (role) => {
    for (const wall of ['2026-10-30T15:00:00', '2026-11-01T00:10:00']) {
      const start = new Date(`${wall}Z`) // Prisma exposes WIB wall components as UTC
      const cutoff = Date.parse(`${wall}+07:00`) - 48 * 3_600_000
      expect(canRescheduleAt(start, new Date(cutoff - 1), role)).toBe(true)
      expect(canRescheduleAt(start, new Date(cutoff), role)).toBe(true)
      expect(canRescheduleAt(start, new Date(cutoff + 1), role)).toBe(false)
      expect(canRescheduleAt(start, new Date(cutoff + 7 * 3_600_000), role)).toBe(false)
    }
  },
)
