import { expect, it, vi } from 'vitest'
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/services/midtrans.service', () => ({
  midtransService: {},
  isPaidStatus: vi.fn(),
}))
vi.mock('@/services/xendit.service', () => ({ xenditService: {} }))
import { finalizeSuccessfulPayment } from './payment-reconcile.service'
it('keeps an admin-cancelled membership cancelled when a late paid gateway callback arrives', async () => {
  const tx = {
    invoice: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: 'invoice',
          status: 'CANCELLED',
          membershipUser: { suspensionReason: 'Dibatalkan oleh admin' },
        }),
      updateMany: vi.fn(),
    },
  }
  const result = await finalizeSuccessfulPayment(tx as any, {
    invoiceId: 'invoice',
  })
  expect(result.outcome).toBe('paid_needs_manual_review')
  expect(tx.invoice.updateMany).not.toHaveBeenCalled()
})
