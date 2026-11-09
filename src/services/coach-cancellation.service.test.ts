import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ tx: {} as any, context: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    bookingCoach: { findFirst: mocks.context },
    $transaction: (fn: any) => fn(mocks.tx),
  },
}))
import {
  cancelBookedCoach,
  previewCoachCancellation,
} from './coach-cancellation.service'
const now = new Date('2026-11-01T05:00:00Z')
let item: any
beforeEach(() => {
  vi.clearAllMocks()
  item = {
    id: 'coach-booking',
    bookingId: 'service',
    slotId: 'coach-slot',
    status: 'CONFIRMED',
    price: 150000,
    slot: {
      staffId: 'staff',
      startAt: new Date('2026-11-02T13:00:00Z'),
      endAt: new Date('2026-11-02T14:00:00Z'),
      staff: { name: 'Coach A' },
    },
    booking: {
      branchId: 'cemara',
      status: 'CONFIRMED',
      serviceForBookingId: 'court',
      adminNote: 'Catatan lama',
      invoice: { number: 'INV-PAID', total: 195000, status: 'PAID' },
    },
  }
  mocks.context.mockImplementation(async () => item)
  mocks.tx = {
    $queryRaw: vi.fn(),
    bookingCoach: {
      findFirst: mocks.context,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    slot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    booking: { update: vi.fn() },
    invoice: { update: vi.fn() },
    payment: { update: vi.fn() },
    bookingBallboy: { updateMany: vi.fn() },
  }
})
const cancel = () =>
  cancelBookedCoach(
    'coach-booking',
    { expectedSlotId: 'coach-slot', reason: 'Coach berhalangan' },
    'super-admin',
    now,
  )
it('cancels only the selected coach, releases safely, records the actor, and preserves paid invoice and other services', async () => {
  expect(await cancel()).toMatchObject({
    status: 'CANCELLED',
    refundRequired: true,
    slotReleased: true,
    price: 150000,
  })
  expect(mocks.tx.bookingCoach.updateMany).toHaveBeenCalledWith({
    where: { id: 'coach-booking', slotId: 'coach-slot', status: 'CONFIRMED' },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancellationReason: 'Coach berhalangan',
    },
  })
  expect(mocks.tx.slot.updateMany.mock.calls[0][0]).toMatchObject({
    where: {
      id: 'coach-slot',
      scheduleClosed: false,
      bookingCoaches: { none: { status: { not: 'CANCELLED' } } },
    },
    data: { isAvailable: true },
  })
  expect(
    mocks.tx.bookingCoach.updateMany.mock.invocationCallOrder[0],
  ).toBeLessThan(mocks.tx.slot.updateMany.mock.invocationCallOrder[0])
  const data = mocks.tx.booking.update.mock.calls[0][0].data
  expect(data).toEqual({ adminNote: expect.any(String) })
  for (const text of [
    'Catatan lama',
    'Coach A',
    'super-admin',
    'Coach berhalangan',
    'refund manual',
  ])
    expect(data.adminNote).toContain(text)
  expect(mocks.tx.invoice.update).not.toHaveBeenCalled()
  expect(mocks.tx.payment.update).not.toHaveBeenCalled()
  expect(mocks.tx.bookingBallboy.updateMany).not.toHaveBeenCalled()
})
it('does not advertise a refund for a free coach', async () => {
  item.price = 0
  expect(await previewCoachCancellation('coach-booking', now)).toMatchObject({
    refundRequired: false,
    invoiceNumber: 'INV-PAID',
  })
  expect(await cancel()).toMatchObject({ refundRequired: false })
})
it('keeps a slot closed if it cannot be safely released', async () => {
  mocks.tx.slot.updateMany.mockResolvedValue({ count: 0 })
  expect(await cancel()).toMatchObject({ slotReleased: false })
})
it('rejects a stale assignment after waiting for the booking locks', async () => {
  mocks.context
    .mockResolvedValueOnce(item)
    .mockResolvedValue({ ...item, slotId: 'replacement-slot' })
  await expect(cancel()).rejects.toThrow('sudah diganti')
  expect(mocks.tx.bookingCoach.updateMany).not.toHaveBeenCalled()
  expect(mocks.tx.slot.updateMany).not.toHaveBeenCalled()
})
it('does not release slots if another update has already cancelled the coach', async () => {
  mocks.tx.bookingCoach.updateMany.mockResolvedValue({ count: 0 })
  await expect(cancel()).rejects.toThrow('berubah')
  expect(mocks.tx.slot.updateMany).not.toHaveBeenCalled()
  expect(mocks.tx.booking.update).not.toHaveBeenCalled()
})
it.each(['CANCELLED', 'HOLD'])(
  'rejects a %s coach before mutations',
  async (status) => {
    item.status = status
    await expect(cancel()).rejects.toThrow('terkonfirmasi')
    expect(mocks.tx.bookingCoach.updateMany).not.toHaveBeenCalled()
  },
)
it('allows cleanup when the parent was already cancelled', async () => {
  item.booking.status = 'CANCELLED'
  item.booking.invoice.status = 'CANCELLED'
  expect(await cancel()).toMatchObject({
    status: 'CANCELLED',
    slotReleased: true,
  })
})
it('rejects an unpaid invoice and elapsed hours', async () => {
  item.booking.status = 'CONFIRMED'
  item.booking.invoice.status = 'PENDING'
  await expect(cancel()).rejects.toThrow('Invoice belum lunas')
  item.booking.invoice.status = 'PAID'
  item.slot.startAt = now
  await expect(cancel()).rejects.toThrow('15 menit')
})
it('rejects a coach booking outside the current branch before locking', async () => {
  mocks.context.mockResolvedValue(null)
  await expect(cancel()).rejects.toThrow('cabang')
  expect(mocks.tx.$queryRaw).not.toHaveBeenCalled()
})
