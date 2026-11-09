import { expect, it, vi } from 'vitest'
import { finalizeSuccessfulPayment } from './payment-reconcile.service'
import { cancelHoldBookingAndReleaseResources } from './booking-cancel.service'

it.each(['COACH', 'BALLBOY'])(
  'does not revive a manually cancelled %s after expiry and late payment',
  async (kind) => {
    const expiry = new Date('2026-11-09T01:20:00Z')
    const manual = new Date('2026-11-09T01:05:00Z')
    const row = {
      slotId: 'slot',
      status: 'CANCELLED',
      cancelledAt: manual,
      cancellationReason: 'Dibatalkan kasir',
    }
    const tx = {
      $executeRaw: vi.fn(),
      invoice: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'invoice',
            number: 'INV',
            status: 'EXPIRED',
            bookingId: 'booking',
            booking: { status: 'CANCELLED' },
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      booking: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'booking',
            status: 'CANCELLED',
            cancelledAt: expiry,
            cancellationReason: 'Hold period expired',
          }),
        update: vi.fn(),
      },
      bookingDetail: { findMany: vi.fn().mockResolvedValue([]) },
      bookingCoach: {
        findMany: vi.fn().mockResolvedValue(kind === 'COACH' ? [row] : []),
        updateMany: vi.fn(),
      },
      bookingBallboy: {
        findMany: vi.fn().mockResolvedValue(kind === 'BALLBOY' ? [row] : []),
        updateMany: vi.fn(),
      },
      slot: { updateMany: vi.fn() },
    }
    expect(
      await finalizeSuccessfulPayment(tx as any, {
        invoiceId: 'invoice',
        paidAt: expiry,
      }),
    ).toMatchObject({ outcome: 'paid_needs_manual_review' })
    expect(tx.slot.updateMany).not.toHaveBeenCalled()
    expect(tx.bookingCoach.updateMany).not.toHaveBeenCalled()
    expect(tx.bookingBallboy.updateMany).not.toHaveBeenCalled()
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { adminNote: expect.stringContaining('remains CANCELLED') },
      }),
    )
  },
)
it('does not reopen reused or manually closed service slots when the old unpaid invoice expires', async () => {
  const tx = {
    booking: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ membershipUserId: null }),
    },
    bookingDetail: { findMany: vi.fn().mockResolvedValue([]) },
    bookingCoach: {
      findMany: vi.fn().mockResolvedValue([{ slotId: 'reused-slot' }]),
      updateMany: vi.fn(),
    },
    bookingBallboy: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
    },
    bookingInventory: { findMany: vi.fn().mockResolvedValue([]) },
    slot: { updateMany: vi.fn() },
  }
  await cancelHoldBookingAndReleaseResources(tx as any, {
    bookingId: 'old',
    reason: 'Expired',
  })
  expect(tx.slot.updateMany).toHaveBeenCalledWith({
    where: {
      id: { in: ['reused-slot'] },
      scheduleClosed: false,
      bookingDetails: { none: { booking: { status: { not: 'CANCELLED' } } } },
      bookingCoaches: {
        none: {
          status: { not: 'CANCELLED' },
          booking: { status: { not: 'CANCELLED' } },
        },
      },
      bookingBallboys: {
        none: {
          status: { not: 'CANCELLED' },
          booking: { status: { not: 'CANCELLED' } },
        },
      },
    },
    data: { isAvailable: true },
  })
})
