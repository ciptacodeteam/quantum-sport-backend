import { afterEach, expect, it, vi } from 'vitest'
vi.mock('./prisma', () => ({
  db: { invoice: { findUnique: vi.fn(async () => null) } },
}))
import { generateInvoiceNumber } from './utils'
afterEach(() => vi.useRealTimers())
it('uses the Jakarta calendar date for invoice numbers across UTC midnight', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T17:30:00Z'))
  expect(await generateInvoiceNumber()).toMatch(/^INV-261101-/)
})
