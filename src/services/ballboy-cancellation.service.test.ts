import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ tx: {} as any, context: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    bookingBallboy: { findFirst: mocks.context },
    $transaction: (fn: any) => fn(mocks.tx),
  },
}))
import {
  cancelBookedBallboy,
  previewBallboyCancellation,
} from './ballboy-cancellation.service'
const now = new Date('2026-11-01T05:00:00Z')
let item: any
beforeEach(() => {
  vi.clearAllMocks()
  item = {
    id: 'ballboy-booking',
    bookingId: 'service',
    slotId: 'ballboy-slot',
    status: 'CONFIRMED',
    price: 150000,
    slot: {
      staffId: 'staff',
      startAt: new Date('2026-11-02T13:00:00Z'),
      endAt: new Date('2026-11-02T14:00:00Z'),
      staff: { name: 'Ballboy A' },
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
    bookingBallboy: {
      findFirst: mocks.context,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    slot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    booking: { update: vi.fn() },
    invoice: { update: vi.fn() },
    payment: { update: vi.fn() },
    bookingCoach: { updateMany: vi.fn() },
  }
})
const cancel = () =>
  cancelBookedBallboy(
    'ballboy-booking',
    { expectedSlotId: 'ballboy-slot', reason: 'Ballboy berhalangan' },
    'super-admin',
    now,
  )
it('cancels only the selected ballboy, releases safely, records the actor, and preserves paid invoice and other services', async () => {
  expect(await cancel()).toMatchObject({
    status: 'CANCELLED',
    refundRequired: true,
    slotReleased: true,
    price: 150000,
  })
  expect(mocks.tx.bookingBallboy.updateMany).toHaveBeenCalledWith({
    where: {
      id: 'ballboy-booking',
      slotId: 'ballboy-slot',
      status: 'CONFIRMED',
    },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancellationReason: 'Ballboy berhalangan',
    },
  })
  expect(mocks.tx.slot.updateMany.mock.calls[0][0]).toMatchObject({
    where: {
      id: 'ballboy-slot',
      scheduleClosed: false,
      bookingBallboys: { none: { status: { not: 'CANCELLED' } } },
    },
    data: { isAvailable: true },
  })
  expect(
    mocks.tx.bookingBallboy.updateMany.mock.invocationCallOrder[0],
  ).toBeLessThan(mocks.tx.slot.updateMany.mock.invocationCallOrder[0])
  const data = mocks.tx.booking.update.mock.calls[0][0].data
  expect(data).toEqual({ adminNote: expect.any(String) })
  for (const text of [
    'Catatan lama',
    'Ballboy A',
    'super-admin',
    'Ballboy berhalangan',
    'refund manual',
  ])
    expect(data.adminNote).toContain(text)
  expect(mocks.tx.invoice.update).not.toHaveBeenCalled()
  expect(mocks.tx.payment.update).not.toHaveBeenCalled()
  expect(mocks.tx.bookingCoach.updateMany).not.toHaveBeenCalled()
})
it('does not advertise a refund for a free ballboy', async () => {
  item.price = 0
  expect(
    await previewBallboyCancellation('ballboy-booking', now),
  ).toMatchObject({
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
  expect(mocks.tx.bookingBallboy.updateMany).not.toHaveBeenCalled()
  expect(mocks.tx.slot.updateMany).not.toHaveBeenCalled()
})
it('does not release slots if another update has already cancelled the ballboy', async () => {
  mocks.tx.bookingBallboy.updateMany.mockResolvedValue({ count: 0 })
  await expect(cancel()).rejects.toThrow('berubah')
  expect(mocks.tx.slot.updateMany).not.toHaveBeenCalled()
  expect(mocks.tx.booking.update).not.toHaveBeenCalled()
})
it('rejects an already cancelled ballboy', async () => {
  item.status = 'CANCELLED'
  await expect(cancel()).rejects.toThrow('sudah dibatalkan')
  expect(mocks.tx.bookingBallboy.updateMany).not.toHaveBeenCalled()
})
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
it('rejects a ballboy booking outside the current branch before locking', async () => {
  mocks.context.mockResolvedValue(null)
  await expect(cancel()).rejects.toThrow('cabang')
  expect(mocks.tx.$queryRaw).not.toHaveBeenCalled()
})

it.each(['HOLD', 'CONFIRMED'])(
  'cancels a %s service on an unpaid HOLD booking',
  async (status) => {
    item.status = status
    item.booking.status = 'HOLD'
    item.booking.invoice.status = 'PENDING'
    expect(
      await previewBallboyCancellation('ballboy-booking', now),
    ).toMatchObject({ refundRequired: false })
    expect(await cancel()).toMatchObject({
      status: 'CANCELLED',
      slotReleased: true,
      refundRequired: false,
    })
    expect(mocks.tx.bookingBallboy.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ballboy-booking', slotId: 'ballboy-slot', status },
      }),
    )
    expect(mocks.tx.invoice.update).not.toHaveBeenCalled()
    expect(mocks.tx.payment.update).not.toHaveBeenCalled()
  },
)
