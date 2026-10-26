import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  db: { paymentMethod: { findUnique: vi.fn() }, $transaction: vi.fn() },
  gateway: { charge: vi.fn(), cancel: vi.fn() },
  notify: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ db: mocks.db }))
vi.mock('@/env', () => ({
  env: {
    xendit: { apiKey: 'test-only' },
    midtrans: { serverKey: 'SB-Mid-server-test', clientKey: 'SB-Mid-client-test', merchantId: 'M' },
    frontEndUrl: 'http://localhost:3000',
  },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/middlewares/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/utils', () => ({
  generateInvoiceNumber: async () => 'INV-UNIT-TEST',
}))
vi.mock('@/services/midtrans.service', () => ({ midtransService: mocks.gateway }))
vi.mock('@/services/xendit.service', () => ({ xenditService: mocks.gateway }))
vi.mock('@/services/notification.service', () => ({
  notificationService: { createBookingAdminNotification: mocks.notify },
}))
vi.mock('@/services/inventory-availability.service', () => ({
  getInventoryAvailabilityMap: async () => new Map(),
}))
import { checkoutHandler } from './checkout.handler'
import { extendedCheckoutSchema } from '@/lib/validation'
let tx: any
let booking: any
const membership = {
  id: 'membership-user',
  remainingSessions: 5,
  membership: { type: 'ALL_HOUR', sport: 'PADEL' },
}
beforeEach(() => {
  vi.clearAllMocks()
  booking = {
    id: 'booking',
    status: 'HOLD',
    userId: 'customer',
    totalPrice: 0,
    processingFee: 0,
  }
  tx = {
    booking: {
      create: vi.fn(async () => booking),
      update: vi.fn(async ({ data }) => Object.assign(booking, data)),
    },
    slot: {
      findMany: vi.fn(async () => [
        {
          id: 'court-slot',
          courtId: 'court',
          price: 200000,
          discountPrice: 0,
          startAt: new Date('2030-10-23T08:00:00Z'),
          endAt: new Date('2030-10-23T09:00:00Z'),
          court: { sport: 'PADEL' },
          bookingDetails: [],
        },
      ]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    bookingDetail: { create: vi.fn() },
    membershipUser: {
      findMany: vi.fn(async () => [membership]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    invoice: {
      create: vi.fn(async ({ data }) => ({ id: 'invoice', ...data })),
      update: vi.fn(),
    },
    payment: {
      create: vi.fn(async ({ data }) => ({ id: 'payment', ...data })),
    },
    user: { findUnique: vi.fn(async () => ({ name: 'Customer' })) },
    inventory: {
      findUnique: vi.fn(async () => ({
        id: 'towel',
        name: 'Towel',
        price: 20000,
        quantity: 10,
        isActive: true,
        sport: 'PADEL',
      })),
      update: vi.fn(),
    },
    bookingInventory: { create: vi.fn() },
  }
  mocks.db.$transaction.mockImplementation(async (callback) => callback(tx))
  mocks.db.paymentMethod.findUnique.mockResolvedValue({
    id: 'qris',
    isActive: true,
    channel: 'QRIS',
    fees: 1000,
    percentage: '0',
  })
  mocks.gateway.charge.mockResolvedValue({
    id: 'payment-request',
    transaction_id: 'payment-request',
    status: 'PENDING',
    actions: [],
  })
})
async function checkout(body: object) {
  const c = {
    get: () => ({ id: 'customer' }),
    req: { valid: () => body },
    var: {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
    },
    json: (value: unknown) => value,
  }
  return (checkoutHandler.at(-1) as any)(c, vi.fn())
}
it('confirms a membership-covered booking without a payment method, fees or gateway request', async () => {
  const response = await checkout({
    courtSlots: ['court-slot'],
    useMembership: true,
  })
  expect(response.data).toMatchObject({
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    total: 0,
    processingFee: 0,
  })
  expect(tx.invoice.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: 'PAID',
        paidAt: expect.any(Date),
        dueDate: expect.any(Date),
      }),
    }),
  )
  const invoiceData = tx.invoice.create.mock.calls[0][0].data
  expect(invoiceData.dueDate).toEqual(invoiceData.issuedAt)
  expect(invoiceData.paidAt).toEqual(invoiceData.issuedAt)
  expect(tx.booking.update).toHaveBeenCalledWith({
    where: { id: 'booking' },
    data: { status: 'CONFIRMED', holdExpiresAt: null },
  })
  expect(tx.payment.create).not.toHaveBeenCalled()
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
  expect(
    tx.membershipUser.updateMany.mock.calls.filter(
      ([arg]: any) => arg.data.remainingSessions?.decrement,
    ),
  ).toHaveLength(1)
})
it('still skips gateway fees when a stale selected payment method was supplied', async () => {
  const response = await checkout({
    courtSlots: ['court-slot'],
    useMembership: true,
    paymentMethodId: 'qris',
  })
  expect(response.data.total).toBe(0)
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})
it('requires payment if the membership is no longer eligible on the server', async () => {
  tx.membershipUser.findMany.mockResolvedValue([])
  await expect(
    checkout({ courtSlots: ['court-slot'], useMembership: true }),
  ).rejects.toThrow('Pilih metode pembayaran')
  expect(tx.invoice.create).not.toHaveBeenCalled()
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})
it('rejects a membership balance lost to a concurrent checkout', async () => {
  tx.membershipUser.updateMany.mockResolvedValue({ count: 0 })
  await expect(
    checkout({ courtSlots: ['court-slot'], useMembership: true }),
  ).rejects.toThrow('sisa jam tidak mencukupi')
  expect(tx.invoice.create).not.toHaveBeenCalled()
})
it('keeps paid add-ons in the regular payment flow', async () => {
  const response = await checkout({
    courtSlots: ['court-slot'],
    useMembership: true,
    paymentMethodId: 'qris',
    inventories: [{ inventoryId: 'towel', quantity: 1 }],
  })
  expect(response.data).toMatchObject({
    paymentStatus: 'PENDING',
    total: 21110,
  })
  expect(mocks.gateway.charge).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 21110 }),
  )
  expect(tx.payment.create).toHaveBeenCalledOnce()
  const invoiceData = tx.invoice.create.mock.calls[0][0].data
  expect(invoiceData.paidAt).toBeNull()
  expect(invoiceData.dueDate.getTime() - invoiceData.issuedAt.getTime()).toBe(
    15 * 60 * 1000,
  )
})
it('accepts an omitted payment method for server-side eligibility checks', () => {
  expect(
    extendedCheckoutSchema.safeParse({
      courtSlots: ['court-slot'],
      useMembership: true,
    }).success,
  ).toBe(true)
})
