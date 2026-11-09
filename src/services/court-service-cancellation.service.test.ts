import { expect, it, vi } from 'vitest'
import { cancelCourtBookingServices } from './court-service-cancellation.service'

function context(coaches: any[] = [], ballboys: any[] = []) {
  return {
    $queryRaw: vi.fn(),
    bookingCoach: {
      findMany: vi.fn().mockResolvedValue(coaches),
      updateMany: vi.fn(),
    },
    bookingBallboy: {
      findMany: vi.fn().mockResolvedValue(ballboys),
      updateMany: vi.fn(),
    },
    slot: { updateMany: vi.fn() },
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        adminNote: 'Catatan',
        invoice: { status: 'PAID', number: 'INV' },
      }),
      update: vi.fn(),
    },
    invoice: { update: vi.fn() },
    payment: { update: vi.fn() },
  }
}
it.each(['coach', 'ballboy', 'both'])(
  'cancels %s including separate invoices and legacy court-slot links',
  async (kind) => {
    const row = (id: string) => ({
      id,
      slotId: id,
      bookingId: `invoice-${id}`,
      slot: { staffId: `staff-${id}` },
    })
    const tx = context(
      kind !== 'ballboy' ? [row('coach')] : [],
      kind !== 'coach' ? [row('ballboy')] : [],
    )
    const result = await cancelCourtBookingServices(
      tx as any,
      'court-booking',
      ['court-slot'],
      'Lapangan dibatalkan',
    )
    expect(result).toEqual({
      coachSlots: kind !== 'ballboy' ? 1 : 0,
      ballboySlots: kind !== 'coach' ? 1 : 0,
    })
    const where = tx.bookingCoach.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { bookingId: 'court-booking' },
      { booking: { serviceForBookingId: 'court-booking' } },
      { courtSlotId: { in: ['court-slot'] } },
    ])
    for (const model of [tx.bookingCoach, tx.bookingBallboy]) {
      expect(model.updateMany).toHaveBeenCalledWith({
        where,
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancellationReason: 'Lapangan dibatalkan',
        }),
      })
    }
    expect(tx.slot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduleClosed: false,
          bookingCoaches: {
            none: {
              status: { not: 'CANCELLED' },
              booking: { status: { not: 'CANCELLED' } },
            },
          },
        }),
        data: { isAvailable: true },
      }),
    )
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { adminNote: expect.stringContaining('tinjau refund manual') },
      }),
    )
    expect(tx.invoice.update).not.toHaveBeenCalled()
    expect(tx.payment.update).not.toHaveBeenCalled()
  },
)
it('handles a court without services without reopening other slots', async () => {
  const tx = context()
  expect(
    await cancelCourtBookingServices(tx as any, 'court', [], 'Batal'),
  ).toEqual({ coachSlots: 0, ballboySlots: 0 })
  expect(tx.slot.updateMany).not.toHaveBeenCalled()
  expect(tx.booking.update).not.toHaveBeenCalled()
  expect(tx.bookingCoach.findMany.mock.calls[0][0].where.OR).toHaveLength(2)
})
it('releases the current assignment if a legacy service was replaced while waiting for locks', async () => {
  const old = {
    id: 'coach',
    bookingId: 'service',
    slotId: 'old-slot',
    slot: { staffId: 'old-staff' },
  }
  const current = { ...old, slotId: 'new-slot', slot: { staffId: 'new-staff' } }
  const tx = context([old])
  tx.bookingCoach.findMany
    .mockResolvedValueOnce([old])
    .mockResolvedValue([current])
  await cancelCourtBookingServices(tx as any, 'court', ['court-slot'], 'Batal')
  expect(tx.slot.updateMany.mock.calls[0][0].where.id.in).toEqual(['new-slot'])
})
