import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/utils', () => ({
  generateInvoiceNumber: vi.fn().mockResolvedValue('INV-RESCHEDULE'),
}))
import { recordRescheduleCharge } from './reschedule-charge.service'
import {
  readRescheduleCharge,
  type RescheduleCharge,
} from '@/lib/reschedule-charge'
const charge: RescheduleCharge = {
  source: 'ADMIN_COURT_RESCHEDULE',
  detailId: 'detail',
  courtBookingId: 'original',
  courtAmount: 100000,
  services: [],
}
let tx: any
beforeEach(() => {
  tx = {
    $queryRaw: vi.fn(),
    paymentMethod: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: 'cash',
          name: 'Tunai',
          isActive: true,
          isOffline: true,
        }),
    },
    booking: { create: vi.fn().mockResolvedValue({ id: 'extra-booking' }) },
    payment: { create: vi.fn().mockResolvedValue({ id: 'extra-payment' }) },
    invoice: { create: vi.fn().mockResolvedValue({ id: 'extra-invoice' }) },
  }
})
it('records the increase in a new paid receipt linked to the original booking without modifying old receipts', async () => {
  await recordRescheduleCharge(tx, charge, {
    branchId: 'cemara',
    userId: 'customer',
    actorId: 'cashier',
    paymentMethodId: 'cash',
  })
  expect(tx.booking.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      serviceForBookingId: 'original',
      totalPrice: 100000,
      status: 'CONFIRMED',
    }),
  })
  expect(tx.payment.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ amount: 100000, status: 'PAID', fees: 0 }),
  })
  expect(
    readRescheduleCharge(tx.payment.create.mock.calls[0][0].data.meta),
  ).toEqual(charge)
  expect(tx.invoice.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      subtotal: 100000,
      total: 100000,
      bookingId: 'extra-booking',
      paymentId: 'extra-payment',
      status: 'PAID',
    }),
  })
})
it('creates no payment or invoice for a cheaper or equal destination', async () => {
  expect(
    await recordRescheduleCharge(
      tx,
      { ...charge, courtAmount: 0 },
      { branchId: 'cemara', userId: 'customer', actorId: 'cashier' },
    ),
  ).toBeNull()
  expect(tx.booking.create).not.toHaveBeenCalled()
  expect(tx.payment.create).not.toHaveBeenCalled()
})
it.each([{}, { paymentMethodId: 'cash' }])(
  'requires a customer and an explicit payment method before charging',
  async (patch) => {
    await expect(
      recordRescheduleCharge(tx, charge, {
        branchId: 'cemara',
        userId: null,
        actorId: 'cashier',
        ...patch,
      }),
    ).rejects.toThrow(/metode pembayaran/)
    expect(tx.payment.create).not.toHaveBeenCalled()
  },
)
it('rejects inactive or online payment methods without recording money', async () => {
  tx.paymentMethod.findFirst.mockResolvedValue({
    id: 'online',
    isActive: true,
    isOffline: false,
    channel: 'SNAP',
  })
  await expect(
    recordRescheduleCharge(tx, charge, {
      branchId: 'cemara',
      userId: 'customer',
      actorId: 'cashier',
      paymentMethodId: 'online',
    }),
  ).rejects.toThrow(/offline/)
  expect(tx.booking.create).not.toHaveBeenCalled()
})
