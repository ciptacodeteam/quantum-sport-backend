import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  tx: {} as any,
  rules: [] as any[],
  payload: {} as any,
}))
vi.mock('@/lib/prisma', () => ({
  db: { $transaction: (fn: any) => fn(mocks.tx) },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: any[]) => handlers },
}))
vi.mock('@/services/membership-renewal.service', () => ({
  lockCustomerWallet: vi.fn(),
}))
vi.mock('@/services/slot-claim.service', () => ({
  claimSlotsAtomically: vi.fn(),
}))
vi.mock('@/services/coach-booking-conflict.service', () => ({
  assertCoachSlotsDoNotConflict: vi.fn(),
}))
vi.mock('@/services/tariff-policy.service', () => ({
  getTariffPeriods: async () => mocks.rules,
}))
vi.mock('@/services/recurring-booking.service', () => ({
  createRecurringBooking: vi.fn(),
}))
vi.mock('@/lib/utils', () => ({
  generateInvoiceNumber: async () => 'INV-ADMIN-TEST',
}))
import { adminCheckoutHandler } from './checkout.handler'
const range = {
  startAt: new Date('2040-01-02T10:00:00Z'),
  endAt: new Date('2040-01-02T11:00:00Z'),
}
beforeEach(() => {
  vi.clearAllMocks()
  const court = {
    ...range,
    id: 'court-slot',
    branchId: 'cemara',
    courtId: 'court',
    court: { sport: 'PADEL' },
    price: 150000,
    discountPrice: 0,
    bookingDetails: [],
  }
  const coach = {
    ...range,
    id: 'coach-slot',
    staff: { coachType: 'PADEL' },
    price: 200000,
    bookingCoaches: [],
  }
  mocks.rules = [
    {
      branchId: 'cemara',
      sport: 'PADEL',
      effectiveFrom: '2039-01-01',
      happyStart: 6,
      happyEnd: 15,
      peakStart: 15,
      peakEnd: 24,
      happyCoachDiscount: 45000,
      peakCoachDiscount: 25000,
    },
  ]
  mocks.payload = {
    paymentMethodId: 'cash',
    userId: 'customer',
    totalHours: 1,
    courtSlots: ['court-slot'],
    coachSlots: ['coach-slot'],
    useMembership: false,
  }
  mocks.tx = {
    $queryRaw: vi.fn(),
    paymentMethod: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'cash',
        name: 'Tunai Kasir',
        isActive: true,
        isOffline: true,
        channel: null,
      }),
    },
    payment: { create: vi.fn().mockResolvedValue({ id: 'recorded-payment' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'customer' }) },
    slot: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }) =>
          where.type === 'COACH' ? [coach] : [court],
        ),
    },
    booking: {
      create: vi.fn().mockResolvedValue({ id: 'booking' }),
      update: vi.fn(),
    },
    bookingDetail: {
      create: vi.fn(),
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'detail', discountPrice: 150000 }),
      update: vi.fn(),
    },
    bookingCoachType: { findFirst: vi.fn().mockResolvedValue({ id: 'type' }) },
    bookingCoach: { create: vi.fn() },
    invoice: { create: vi.fn().mockResolvedValue({ id: 'invoice' }) },
  }
})
async function checkout() {
  const json = vi.fn()
  await (adminCheckoutHandler.at(-1) as any)(
    {
      get: () => ({ id: 'admin' }),
      req: { valid: () => mocks.payload },
      var: { logger: { info: vi.fn(), warn: vi.fn(), fatal: vi.fn() } },
      json,
    },
    vi.fn(),
  )
  return json
}
it('persists the configured discount in court detail, booking totals and invoice in one admin checkout', async () => {
  const json = await checkout()
  expect(mocks.tx.bookingDetail.update).toHaveBeenCalledWith({
    where: { id: 'detail' },
    data: { discountPrice: { decrement: 45000 } },
  })
  expect(mocks.tx.booking.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        totalPrice: 305000,
        courtDiscountPrice: 105000,
      }),
    }),
  )
  expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ total: 305000 }),
    }),
  )
  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({ success: true }),
    200,
  )
})
it('charges the normal court amount when no coach is selected or the configured amount is zero', async () => {
  mocks.payload.coachSlots = []
  await checkout()
  expect(mocks.tx.bookingDetail.update).not.toHaveBeenCalled()
  expect(mocks.tx.booking.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ totalPrice: 150000 }),
    }),
  )
  mocks.payload.coachSlots = ['coach-slot']
  mocks.rules[0].happyCoachDiscount = 0
  await checkout()
  expect(mocks.tx.bookingDetail.update).not.toHaveBeenCalled()
  expect(mocks.tx.booking.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ totalPrice: 350000 }),
    }),
  )
})
it('caps the coaching discount at the paid court price', async () => {
  mocks.rules[0].happyCoachDiscount = 500000
  await checkout()
  expect(mocks.tx.bookingDetail.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { discountPrice: { decrement: 150000 } } }),
  )
  expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ total: 200000 }),
    }),
  )
})

it('validates and saves the selected coaching group with the booked coach', async () => {
  const [coach] = await mocks.tx.slot.findMany({ where: { type: 'COACH' } })
  coach.staff.id = 'staff-coach'
  coach.staff.coachingGroups = [
    {
      group: {
        id: 'academy',
        name: 'SR Academy',
        isActive: true,
        sports: ['PADEL'],
        branches: [{ branchId: 'cemara' }],
      },
    },
  ]
  coach.branchId = 'cemara'
  mocks.tx.$queryRaw = vi.fn()
  mocks.tx.coachingGroup = {
    findFirst: vi.fn().mockResolvedValue({ id: 'academy', name: 'SR Academy' }),
  }
  mocks.payload.coachGroups = [
    { slotId: 'coach-slot', coachingGroupId: 'academy' },
  ]
  await checkout()
  expect(mocks.tx.coachingGroup.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id: 'academy',
        sports: { hasEvery: ['PADEL'] },
        coaches: { some: { staffId: 'staff-coach' } },
      }),
    }),
  )
  expect(mocks.tx.bookingCoach.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        coachingGroupId: 'academy',
        coachingGroupName: 'SR Academy',
        slotId: 'coach-slot',
      }),
    }),
  )
})
it('refuses a group that does not contain the selected coach or match its branch and sport', async () => {
  mocks.tx.$queryRaw = vi.fn()
  mocks.tx.coachingGroup = { findFirst: vi.fn().mockResolvedValue(null) }
  mocks.payload.coachGroups = [
    { slotId: 'coach-slot', coachingGroupId: 'other-group' },
  ]
  await expect(checkout()).rejects.toThrow('Coach tidak tersedia di grup')
  expect(mocks.tx.bookingCoach.create).not.toHaveBeenCalled()
  expect(mocks.tx.invoice.create).not.toHaveBeenCalled()
})

it.each(['PADEL', 'TENNIS'] as const)(
  'books a ballboy on %s courts regardless of legacy sport and saves the court assignment',
  async (sport) => {
    const [court] = await mocks.tx.slot.findMany({ where: { type: 'COURT' } })
    court.court.sport = sport
    const ballboy = {
      ...range,
      id: 'ballboy-slot',
      staff: { coachType: sport },
      price: 45000,
      bookingBallboys: [],
    }
    mocks.tx.slot.findMany.mockImplementation(({ where }: any) =>
      where.type === 'BALLBOY' ? [ballboy] : [court],
    )
    mocks.tx.bookingBallboy = { create: vi.fn() }
    mocks.payload.coachSlots = []
    mocks.payload.ballboySlots = [
      { slotId: 'ballboy-slot', courtSlotId: 'court-slot' },
    ]
    await checkout()
    expect(mocks.tx.bookingBallboy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slotId: 'ballboy-slot',
          courtSlotId: 'court-slot',
        }),
      }),
    )
    expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ total: 195000 }),
      }),
    )
    ballboy.staff.coachType = sport === 'PADEL' ? 'TENNIS' : 'PADEL'
    mocks.tx.bookingBallboy.create.mockClear()
    await checkout()
    expect(mocks.tx.bookingBallboy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courtSlotId: 'court-slot' }),
      }),
    )
  },
)

it('records the chosen offline method on the paid payment record and links it to the invoice', async () => {
  await checkout()
  expect(mocks.tx.paymentMethod.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id: 'cash',
        isActive: true,
        OR: expect.arrayContaining([{ isOffline: true }]),
      }),
    }),
  )
  expect(mocks.tx.payment.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        paymentMethodId: 'cash',
        amount: 305000,
        status: 'PAID',
        fees: 0,
        meta: expect.objectContaining({
          source: 'ADMIN_COURT_BOOKING',
          receivedBy: 'admin',
        }),
      }),
    }),
  )
  expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        paymentId: 'recorded-payment',
        total: 305000,
        status: 'PAID',
      }),
    }),
  )
})
it('rejects paid bookings without an offline method', async () => {
  delete mocks.payload.paymentMethodId
  await expect(checkout()).rejects.toThrow('Pilih metode pembayaran offline')
  expect(mocks.tx.invoice.create).not.toHaveBeenCalled()
  expect(mocks.tx.payment.create).not.toHaveBeenCalled()
})
it('rejects an unavailable, inactive or online-only method before creating the invoice', async () => {
  mocks.tx.paymentMethod.findFirst.mockResolvedValue(null)
  await expect(checkout()).rejects.toThrow('tidak tersedia atau nonaktif')
  expect(mocks.tx.invoice.create).not.toHaveBeenCalled()
  expect(mocks.tx.payment.create).not.toHaveBeenCalled()
})
it('allows a free booking without recording a fictitious payment method', async () => {
  const [court] = await mocks.tx.slot.findMany({ where: { type: 'COURT' } })
  court.price = 0
  mocks.payload.coachSlots = []
  delete mocks.payload.paymentMethodId
  await checkout()
  expect(mocks.tx.payment.create).not.toHaveBeenCalled()
  expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ total: 0, status: 'PAID' }),
    }),
  )
})
it.each([
  { sport: 'PADEL', date: '2040-01-07', total: 1100000 },
  { sport: 'TENNIS', date: '2040-01-07', total: 1100000 },
  { sport: 'PADEL', date: '2040-01-09', total: 950000 },
  { sport: 'TENNIS', date: '2040-01-09', total: 950000 },
])(
  'keeps $sport court discounts separate from coach prices on $date',
  async ({ sport, date, total }) => {
    const [baseCourt] = await mocks.tx.slot.findMany({
      where: { type: 'COURT' },
    })
    const [baseCoach] = await mocks.tx.slot.findMany({
      where: { type: 'COACH' },
    })
    const courts = Array.from({ length: 5 }, (_, i) => ({
      ...baseCourt,
      id: `court-${i}`,
      branchId: 'cemara',
      court: { sport },
      startAt: new Date(`${date}T${String(13 + i).padStart(2, '0')}:00:00Z`),
      endAt: new Date(`${date}T${String(14 + i).padStart(2, '0')}:00:00Z`),
    }))
    const coaches = courts.map((court, i) => ({
      ...baseCoach,
      id: `coach-${i}`,
      staffId: 'coach-a',
      staff: { coachType: sport },
      startAt: court.startAt,
      endAt: court.endAt,
      additionalHourPrice: 100000,
    }))
    mocks.rules = [
      {
        ...mocks.rules[0],
        sport,
        happyCoachDiscount: 50000,
        peakCoachDiscount: 100000,
        happyAllDayDays: [6, 7],
      },
    ]
    mocks.payload = {
      ...mocks.payload,
      totalHours: 5,
      courtSlots: courts.map((s) => s.id),
      coachSlots: coaches.map((s) => s.id).reverse(),
    }
    mocks.tx.slot.findMany.mockImplementation(({ where }: any) =>
      where.type === 'COACH' ? coaches.reverse() : courts,
    )
    await checkout()
    const charged = mocks.tx.bookingCoach.create.mock.calls.map(
      ([args]: any) => args.data,
    )
    expect(charged.find((row: any) => row.slotId === 'coach-0').price).toBe(
      200000,
    )
    expect(
      charged
        .filter((row: any) => row.slotId !== 'coach-0')
        .every((row: any) => row.price === 100000),
    ).toBe(true)
    // Weekends use Happy Hour throughout; weekdays cross into Peak Hour at 15:00.
    expect(mocks.tx.bookingDetail.update).toHaveBeenCalledTimes(5)
    expect(mocks.tx.bookingDetail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { discountPrice: { decrement: 50000 } },
      }),
    )
    expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ total }),
      }),
    )
  },
)

it.each([1, 3])(
  'checks out a prepaid in-house hour for %s participants without stacking the club discount',
  async (participants) => {
    mocks.payload.coachSlots = []
    mocks.payload.inHouseSelections = [
      {
        walletId: 'wallet',
        courtSlotId: 'court-slot',
        coachSlotId: 'coach-slot',
        participants,
      },
    ]
    mocks.tx.inHouseWallet = {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: 'wallet',
          staffId: 'andi',
          branchId: 'cemara',
          userId: 'customer',
          packageName: 'Andi 5 jam',
          hourlyPrice: 900000,
          courtHourlyShare: 250000,
          extraParticipantHourlyPrice: 100000,
          staff: { isActive: true, role: 'COACH', coachType: 'PADEL' },
        }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    }
    mocks.tx.slot.findFirst = vi
      .fn()
      .mockResolvedValue({
        id: 'coach-slot',
        staffId: 'andi',
        branchId: 'cemara',
        ...range,
      })
    mocks.tx.bookingDetail.findFirst.mockResolvedValue({
      id: 'detail',
      slotId: 'court-slot',
      discountPrice: 150000,
      slot: {
        id: 'court-slot',
        branchId: 'cemara',
        court: { sport: 'PADEL' },
        ...range,
      },
    })
    await checkout()
    expect(mocks.tx.bookingDetail.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'detail' },
      data: { discountPrice: 250000 },
    })
    expect(mocks.tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ total: (participants - 1) * 100000 }),
      }),
    )
    expect(mocks.tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalPrice: (participants - 1) * 100000,
          courtDiscountPrice: 250000,
        }),
      }),
    )
    expect(mocks.tx.payment.create).toHaveBeenCalledTimes(
      participants === 1 ? 0 : 1,
    )
  },
)
it('rejects applying court membership to the same prepaid coaching checkout', async () => {
  mocks.payload.useMembership = true
  mocks.payload.inHouseSelections = [
    {
      walletId: 'wallet',
      courtSlotId: 'court-slot',
      coachSlotId: 'coach-slot',
      participants: 1,
    },
  ]
  await expect(checkout()).rejects.toThrow(/membership/)
  expect(mocks.tx.invoice.create).not.toHaveBeenCalled()
})
