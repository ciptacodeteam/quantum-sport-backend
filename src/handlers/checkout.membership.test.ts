vi.mock('@/services/tariff-policy.service', () => ({
  getTariffPeriods: vi.fn().mockResolvedValue([]),
}))
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => {
  const charge = vi.fn()
  const gateway = {
    charge,
    cancel: vi.fn(),
    checkoutMode: vi.fn(() => 'core' as const),
    initiateCheckoutPayment: vi.fn(async (input: Record<string, unknown>) => {
      const result = await charge(input)
      return {
        mode: 'core' as const,
        charge: result,
        meta: {
          gateway: 'midtrans',
          checkout_mode: 'core',
          payment_request_id: result.transaction_id,
          transaction_id: result.transaction_id,
          order_id: input.orderId,
          status: result.status,
          actions: result.actions,
        },
      }
    }),
  }
  return {
    db: { paymentMethod: { findUnique: vi.fn() }, $transaction: vi.fn() },
    gateway,
    notify: vi.fn(),
  }
})
vi.mock('@/lib/prisma', () => ({ db: mocks.db }))
vi.mock('@/env', () => ({
  env: {
    xendit: { apiKey: 'test-only' },
    midtrans: {
      serverKey: 'SB-Mid-server-test',
      clientKey: 'SB-Mid-client-test',
      merchantId: 'M',
      checkoutMode: 'core' as const,
    },
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
vi.mock('@/services/midtrans.service', () => ({
  midtransService: mocks.gateway,
}))
vi.mock('@/services/xendit.service', () => ({ xenditService: mocks.gateway }))
vi.mock('@/services/notification.service', () => ({
  notificationService: { createBookingAdminNotification: mocks.notify },
}))
vi.mock('@/services/inventory-availability.service', () => ({
  getInventoryAvailabilityMap: async () => new Map(),
}))
import { checkoutHandler } from './checkout.handler'
import { extendedCheckoutSchema } from '@/lib/validation'
import { getTariffPeriods } from '@/services/tariff-policy.service'
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
it.each([
  { inventories: [{ inventoryId: 'towel', quantity: 1 }] },
  { coachSlots: ['coach-slot'] },
])(
  'rejects add-on ordering from the customer checkout before changing stock or payments',
  async (selection) => {
    await expect(
      checkout({
        courtSlots: ['court-slot'],
        useMembership: true,
        paymentMethodId: 'qris',
        ...selection,
      }),
    ).rejects.toThrow(
      'Coach dan perlengkapan hanya dapat dipesan melalui admin.',
    )
    expect(mocks.db.$transaction).not.toHaveBeenCalled()
    expect(mocks.gateway.charge).not.toHaveBeenCalled()
  },
)
it('accepts an omitted payment method for server-side eligibility checks', () => {
  expect(
    extendedCheckoutSchema.safeParse({
      courtSlots: ['court-slot'],
      useMembership: true,
    }).success,
  ).toBe(true)
})

it('uses the same ten-minute deadline for invoice, payment, reservation and gateway', async () => {
  await checkout({ courtSlots: ['court-slot'], paymentMethodId: 'qris' })
  const invoice = tx.invoice.create.mock.calls[0][0].data
  expect(invoice.dueDate.getTime() - invoice.issuedAt.getTime()).toBe(600_000)
  expect(tx.payment.create.mock.calls[0][0].data.dueDate).toEqual(
    invoice.dueDate,
  )
  expect(booking.holdExpiresAt).toEqual(invoice.dueDate)
  expect(mocks.gateway.charge).toHaveBeenCalledWith(
    expect.objectContaining({ expiryMinutes: 10 }),
  )
})

it.each([
  ['2026-10-28T15:00:00+07:00', true],
  ['2026-10-28T15:14:59.999+07:00', true],
  ['2026-10-28T15:15:00+07:00', false],
])('validates checkout grace period at %s', async (now, allowed) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
  tx.slot.findMany.mockResolvedValue([
    {
      id: 'court-slot',
      courtId: 'court',
      price: 200000,
      discountPrice: 0,
      startAt: new Date('2026-10-28T15:00:00Z'),
      endAt: new Date('2026-10-28T16:00:00Z'),
      court: { sport: 'PADEL' },
      bookingDetails: [],
    },
  ])
  try {
    const result = checkout({
      courtSlots: ['court-slot'],
      paymentMethodId: 'qris',
    })
    if (allowed) {
      await result
      expect(tx.slot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            startAt: {
              gt: new Date(new Date(now).getTime() + 7 * 3_600_000 - 900_000),
            },
          }),
        }),
      )
    } else {
      await expect(result).rejects.toThrow('15-minute booking grace period')
      expect(mocks.gateway.charge).not.toHaveBeenCalled()
    }
  } finally {
    vi.useRealTimers()
  }
})

function mixedSlots() {
  // Wall-clock hours (timestamp without time zone): 14–15 happy, 15–16 peak boundary, 16–17 peak
  const slots = [14, 15, 16].map((hour, index) => ({
    id: `slot-${index}`,
    courtId: 'court',
    price: 200000,
    discountPrice: index === 1 ? 150000 : 0,
    startAt: new Date(`2030-10-23T${hour}:00:00Z`),
    endAt: new Date(`2030-10-23T${hour + 1}:00:00Z`),
    court: { sport: 'PADEL' },
    bookingDetails: [],
  }))
  tx.slot.findMany.mockResolvedValue(slots)
  tx.slot.updateMany.mockResolvedValue({ count: 3 })
  return slots.map((slot) => slot.id)
}

it('charges only the cash slot and reserves only two selected membership sessions', async () => {
  const courtSlots = mixedSlots()
  const response = await checkout({
    courtSlots,
    paymentMethodId: 'qris',
    useMembership: true,
    membershipCourtSlotIds: ['slot-0', 'slot-2'],
    membershipUserId: 'membership-user',
  })
  expect(response.data).toMatchObject({
    paymentStatus: 'PENDING',
    total: 151110,
  })
  expect(booking).toMatchObject({
    membershipUserId: 'membership-user',
    membershipSessionsUsed: 2,
    courtDiscountPrice: 150000,
  })
  expect(tx.membershipUser.findMany.mock.calls[0][0].where).toMatchObject({
    id: 'membership-user',
    userId: 'customer',
    remainingSessions: { gte: 2 },
  })
  expect(tx.membershipUser.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { remainingSessions: { decrement: 2 } } }),
  )
  expect(
    tx.bookingDetail.create.mock.calls.map(
      ([arg]: any) => arg.data.discountPrice,
    ),
  ).toEqual([0, 150000, 0])
  expect(mocks.gateway.charge).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 151110 }),
  )
})

it('allows paying all slots without using an available membership', async () => {
  const courtSlots = mixedSlots()
  await checkout({
    courtSlots,
    paymentMethodId: 'qris',
    useMembership: false,
    membershipCourtSlotIds: [],
  })
  expect(tx.membershipUser.findMany).not.toHaveBeenCalled()
  expect(tx.membershipUser.updateMany).not.toHaveBeenCalled()
  expect(booking.membershipSessionsUsed).toBe(0)
  expect(mocks.gateway.charge).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 551110 }),
  )
})

it('confirms explicitly selected membership-only slots without a gateway or payment method', async () => {
  await checkout({
    courtSlots: ['court-slot'],
    useMembership: true,
    membershipCourtSlotIds: ['court-slot'],
  })
  expect(booking.status).toBe('CONFIRMED')
  expect(booking.membershipSessionsUsed).toBe(1)
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})

it.each([
  { ids: ['slot-outside-cart'] },
  { ids: ['court-slot', 'court-slot'] },
])(
  'rejects tampered membership slot selections %j',
  async ({ ids: membershipCourtSlotIds }) => {
    await expect(
      checkout({
        courtSlots: ['court-slot'],
        useMembership: true,
        membershipCourtSlotIds,
      }),
    ).rejects.toThrow('Pilihan slot membership tidak valid')
    expect(mocks.db.$transaction).not.toHaveBeenCalled()
  },
)

it('rejects a membership selection when membership is explicitly disabled', async () => {
  await expect(
    checkout({
      courtSlots: ['court-slot'],
      useMembership: false,
      membershipCourtSlotIds: ['court-slot'],
    }),
  ).rejects.toThrow('Pilihan slot membership tidak valid')
})

it('rejects insufficient or unavailable membership instead of silently charging cash', async () => {
  tx.membershipUser.findMany.mockResolvedValue([])
  await expect(
    checkout({
      courtSlots: ['court-slot'],
      useMembership: true,
      paymentMethodId: 'qris',
      membershipCourtSlotIds: ['court-slot'],
    }),
  ).rejects.toThrow('Membership tidak tersedia')
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})

it('checks package hours only on selected membership slots in a mixed order', async () => {
  const courtSlots = mixedSlots()
  tx.membershipUser.findMany.mockResolvedValue([
    {
      ...membership,
      membership: { ...membership.membership, type: 'HAPPY_HOUR' },
    },
  ])
  await checkout({
    courtSlots,
    paymentMethodId: 'qris',
    useMembership: true,
    membershipCourtSlotIds: ['slot-0'],
  })
  expect(booking.membershipSessionsUsed).toBe(1)
  expect(mocks.gateway.charge).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 351110 }),
  )
})

it('rejects out-of-hours membership slots before consuming quota or requesting payment', async () => {
  const courtSlots = mixedSlots()
  tx.membershipUser.findMany.mockResolvedValue([
    {
      ...membership,
      membership: { ...membership.membership, type: 'HAPPY_HOUR' },
    },
  ])
  await expect(
    checkout({
      courtSlots,
      paymentMethodId: 'qris',
      useMembership: true,
      membershipCourtSlotIds: ['slot-2'],
    }),
  ).rejects.toThrow('Membership tidak tersedia')
  expect(tx.membershipUser.updateMany).not.toHaveBeenCalled()
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})

it('requires a payment method for a mixed membership and cash order', async () => {
  const courtSlots = mixedSlots()
  await expect(
    checkout({
      courtSlots,
      useMembership: true,
      membershipCourtSlotIds: ['slot-0'],
    }),
  ).rejects.toThrow('Pilih metode pembayaran')
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})

it('uses the effective branch tariff instead of the old 15:00 boundary at customer checkout', async () => {
  const slots = await tx.slot.findMany()
  tx.slot.findMany.mockResolvedValue(
    slots.map((slot: any) => ({ ...slot, branchId: 'cemara' })),
  )
  tx.membershipUser.findMany.mockResolvedValue([
    {
      ...membership,
      membership: { ...membership.membership, type: 'HAPPY_HOUR' },
    },
  ])
  vi.mocked(getTariffPeriods).mockResolvedValueOnce([
    {
      happyAllDayDays: [],
      happyCoachDiscount: 0,
      peakCoachDiscount: 0,
      inHouseCourtHourlyPrice: null,
      happyInHouseCoachDiscount: null,
      peakInHouseCoachDiscount: null,
      id: 'rule',
      branchId: 'cemara',
      sport: 'PADEL',
      effectiveFrom: new Date('2029-01-01T00:00:00Z'),
      happyStart: 6,
      happyEnd: 17,
      peakStart: 17,
      peakEnd: 24,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ])
  await checkout({
    courtSlots: ['court-slot'],
    useMembership: true,
    membershipCourtSlotIds: ['court-slot'],
  })
  expect(booking.status).toBe('CONFIRMED')
  expect(booking.membershipSessionsUsed).toBe(1)
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})

it('rejects checkout when a concurrent order has already consumed the selected sessions', async () => {
  tx.membershipUser.updateMany.mockResolvedValue({ count: 0 })
  await expect(
    checkout({
      courtSlots: ['court-slot'],
      useMembership: true,
      membershipCourtSlotIds: ['court-slot'],
      paymentMethodId: 'qris',
    }),
  ).rejects.toThrow('Value Pack sudah tidak tersedia')
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
  expect(tx.invoice.create).not.toHaveBeenCalled()
})

it('rejects a direct customer checkout with an offline payment ID even if its channel is online', async () => {
  mocks.db.paymentMethod.findUnique.mockResolvedValue({
    id: 'offline',
    isActive: true,
    isOffline: true,
    channel: 'QRIS',
    fees: 0,
    percentage: '0',
  })
  await expect(
    checkout({ courtSlots: ['court-slot'], paymentMethodId: 'offline' }),
  ).rejects.toThrow('offline hanya tersedia melalui admin')
  expect(mocks.db.$transaction).not.toHaveBeenCalled()
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})

function publicBallboySlot() {
  return {
    id: 'ballboy-slot',
    staffId: 'ballboy',
    type: 'BALLBOY',
    price: 45000,
    startAt: new Date('2030-10-23T08:00:00Z'),
    endAt: new Date('2030-10-23T09:00:00Z'),
    staff: {
      id: 'ballboy',
      role: 'BALLBOY',
      isActive: true,
      adminServiceOnly: false,
    },
    bookingBallboys: [],
  }
}
it('checks out a standalone ballboy at the server price without a court or membership deduction', async () => {
  const slot = publicBallboySlot()
  tx.slot.findMany.mockResolvedValue([slot])
  tx.slot.findFirst = vi.fn().mockResolvedValue(null)
  tx.$queryRaw = vi.fn().mockResolvedValue([])
  tx.bookingBallboy = { create: vi.fn() }
  const response = await checkout({
    ballboySlots: ['ballboy-slot'],
    paymentMethodId: 'qris',
    useMembership: false,
  })
  expect(tx.bookingBallboy.create).toHaveBeenCalledWith({
    data: {
      bookingId: 'booking',
      slotId: 'ballboy-slot',
      courtSlotId: undefined,
      price: 45000,
    },
  })
  expect(tx.bookingDetail.create).not.toHaveBeenCalled()
  expect(tx.membershipUser.updateMany).not.toHaveBeenCalled()
  expect(tx.slot.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        type: 'BALLBOY',
        scheduleClosed: false,
        startAt: { gt: expect.any(Date) },
        staff: expect.objectContaining({
          role: 'BALLBOY',
          isActive: true,
          adminServiceOnly: false,
        }),
      }),
    }),
  )
  expect(tx.slot.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        type: 'BALLBOY',
        scheduleClosed: false,
        startAt: { gt: expect.any(Date) },
      }),
    }),
  )
  expect(response.data.total).toBe(46110)
  expect(mocks.gateway.charge).toHaveBeenCalled()
})
it('rejects a ballboy slot that was booked before checkout', async () => {
  tx.slot.findMany.mockResolvedValue([
    { ...publicBallboySlot(), bookingBallboys: [{ id: 'other-booking' }] },
  ])
  await expect(
    checkout({
      ballboySlots: ['ballboy-slot'],
      paymentMethodId: 'qris',
      useMembership: false,
    }),
  ).rejects.toThrow('already booked')
  expect(tx.invoice.create).not.toHaveBeenCalled()
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})
it('rejects an unavailable or non-public ballboy slot before payment', async () => {
  tx.slot.findMany.mockResolvedValue([])
  await expect(
    checkout({
      ballboySlots: ['ballboy-slot'],
      paymentMethodId: 'qris',
      useMembership: false,
    }),
  ).rejects.toThrow('not found or unavailable')
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})
it('rejects a court reference on a standalone ballboy order', async () => {
  tx.slot.findMany.mockResolvedValue([publicBallboySlot()])
  await expect(
    checkout({
      ballboySlots: [{ slotId: 'ballboy-slot', courtSlotId: 'not-in-cart' }],
      paymentMethodId: 'qris',
      useMembership: false,
    }),
  ).rejects.toThrow('must match a selected court')
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})
it('rejects started ballboy hours using Jakarta wall time', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-10-23T02:00:00Z')) // 09:00 WIB
  tx.slot.findMany.mockResolvedValue([publicBallboySlot()]) // 08:00 WIB
  try {
    await expect(
      checkout({
        ballboySlots: ['ballboy-slot'],
        paymentMethodId: 'qris',
        useMembership: false,
      }),
    ).rejects.toThrow('already started')
    expect(mocks.gateway.charge).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})
it('rejects another overlapping slot for the same ballboy before charging', async () => {
  tx.slot.findMany.mockResolvedValue([publicBallboySlot()])
  tx.slot.findFirst = vi.fn().mockResolvedValue({ id: 'overlapping-booking' })
  tx.$queryRaw = vi.fn().mockResolvedValue([])
  await expect(
    checkout({
      ballboySlots: ['ballboy-slot'],
      paymentMethodId: 'qris',
      useMembership: false,
    }),
  ).rejects.toThrow('sudah dipesan pada waktu yang sama')
  expect(tx.invoice.create).not.toHaveBeenCalled()
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})

it.each(['PADEL', 'TENNIS'])(
  'pays %s courts and linked ballboys together in one checkout',
  async (sport) => {
    const ballboy = publicBallboySlot()
    const court = {
      id: 'court-slot',
      courtId: 'tennis-court',
      price: 200000,
      discountPrice: 0,
      startAt: ballboy.startAt,
      endAt: ballboy.endAt,
      court: { sport },
      bookingDetails: [],
    }
    tx.slot.findMany.mockImplementation(async ({ where }: any) =>
      where.type === 'BALLBOY' ? [ballboy] : [court],
    )
    tx.slot.findFirst = vi.fn().mockResolvedValue(null)
    tx.$queryRaw = vi.fn().mockResolvedValue([])
    tx.bookingBallboy = { create: vi.fn() }
    const response = await checkout({
      courtSlots: ['court-slot'],
      ballboySlots: [{ slotId: 'ballboy-slot', courtSlotId: 'court-slot' }],
      paymentMethodId: 'qris',
      useMembership: false,
    })
    expect(tx.bookingDetail.create).toHaveBeenCalledOnce()
    expect(tx.bookingBallboy.create).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking',
        slotId: 'ballboy-slot',
        courtSlotId: 'court-slot',
        price: 45000,
      },
    })
    expect(tx.invoice.create).toHaveBeenCalledOnce()
    expect(response.data.total).toBe(246110)
    expect(mocks.gateway.charge).toHaveBeenCalledOnce()
  },
)

it('rejects assigning the same ballboy slot to two Padel courts before payment', async () => {
  const ballboy = publicBallboySlot()
  const courts = ['court-a', 'court-b'].map((id) => ({
    id,
    courtId: id,
    price: 200000,
    discountPrice: 0,
    startAt: ballboy.startAt,
    endAt: ballboy.endAt,
    court: { sport: 'PADEL' },
    bookingDetails: [],
  }))
  tx.slot.findMany.mockImplementation(async ({ where }: any) =>
    where.type === 'BALLBOY' ? [ballboy] : courts,
  )
  tx.slot.updateMany.mockImplementation(async ({ where }: any) => ({
    count: where.id.in.length,
  }))
  await expect(
    checkout({
      courtSlots: courts.map((court) => court.id),
      ballboySlots: courts.map((court) => ({
        slotId: ballboy.id,
        courtSlotId: court.id,
      })),
      paymentMethodId: 'qris',
      useMembership: false,
    }),
  ).rejects.toThrow('multiple court slots')
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
  expect(tx.invoice.create).not.toHaveBeenCalled()
})
it('rejects a linked Padel ballboy whose hour does not match the court', async () => {
  const ballboy = publicBallboySlot()
  const court = {
    id: 'court-slot',
    courtId: 'court',
    price: 200000,
    discountPrice: 0,
    startAt: new Date(+ballboy.startAt + 3600000),
    endAt: new Date(+ballboy.endAt + 3600000),
    court: { sport: 'PADEL' },
    bookingDetails: [],
  }
  tx.slot.findMany.mockImplementation(async ({ where }: any) =>
    where.type === 'BALLBOY' ? [ballboy] : [court],
  )
  await expect(
    checkout({
      courtSlots: [court.id],
      ballboySlots: [{ slotId: ballboy.id, courtSlotId: court.id }],
      paymentMethodId: 'qris',
      useMembership: false,
    }),
  ).rejects.toThrow('must match selected court booking times')
  expect(mocks.gateway.charge).not.toHaveBeenCalled()
})
