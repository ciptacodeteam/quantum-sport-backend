import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  claim: vi.fn(),
  lock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: { $transaction: (fn: any) => mocks.transaction(fn) },
}))
vi.mock('./slot-claim.service', () => ({ claimSlotsAtomically: mocks.claim }))
vi.mock('./membership-renewal.service', () => ({
  lockCustomerWallet: mocks.lock,
}))
vi.mock('@/lib/utils', () => ({
  generateInvoiceNumber: async () => 'INV-INHOUSE',
}))
import {
  deleteUnusedInHouseWallet,
  redeemInHouseSelections,
  restoreInHouseUsage,
  sellInHousePlan,
  saveInHousePlan,
} from './inhouse-coaching.service'
import {
  inHousePlanSchema,
  inHouseSelectionSchema,
  priceInHouseHour,
} from '@/lib/inhouse-coaching'
let tx: any
const range = {
  startAt: new Date('2040-11-03T18:00:00Z'),
  endAt: new Date('2040-11-03T19:00:00Z'),
}
const terms = {
  hourlyPrice: 900000,
  courtHourlyShare: 250000,
  extraParticipantHourlyPrice: 100000,
}
const selection = {
  walletId: 'wallet',
  courtSlotId: 'court-slot',
  coachSlotId: 'coach-slot',
  participants: 3,
}
const input = () => ({
  selections: [selection],
  userId: 'customer',
  bookingId: 'booking',
  courtSlotIds: ['court-slot'],
  clubCoachSlots: [] as (typeof range)[],
})
beforeEach(() => {
  vi.clearAllMocks()
  tx = {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'customer' }) },
    staff: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'andi',
        branchId: 'cemara',
        role: 'COACH',
        isActive: true,
      }),
    },
    inHousePlan: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'plan',
        name: 'Andi 5 jam',
        hours: 5,
        staffId: 'andi',
        branchId: 'cemara',
        staff: { isActive: true, role: 'COACH' },
        ...terms,
      }),
      create: vi.fn(),
      update: vi.fn(),
    },
    inHouseWallet: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'wallet',
        staffId: 'andi',
        branchId: 'cemara',
        userId: 'customer',
        staff: { isActive: true, role: 'COACH', coachType: 'PADEL' },
        packageName: 'Andi 5 jam',
        ...terms,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
      create: vi
        .fn()
        .mockImplementation(({ data }) => ({ ...data, id: 'wallet' })),
    },
    slot: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'coach-slot',
        staffId: 'andi',
        branchId: 'cemara',
        ...range,
      }),
    },
    bookingDetail: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'detail',
        slotId: 'court-slot',
        discountPrice: 300000,
        slot: {
          id: 'court-slot',
          branchId: 'cemara',
          court: { sport: 'PADEL' },
          ...range,
        },
      }),
      update: vi.fn(),
    },
    bookingCoachType: { findFirst: vi.fn().mockResolvedValue({ id: 'type' }) },
    bookingCoach: { create: vi.fn().mockResolvedValue({ id: 'booked-coach' }) },
    inHouseUsage: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'usage', walletId: 'wallet', minutes: 60 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    paymentMethod: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cash', name: 'Cash' }),
    },
    payment: { create: vi.fn().mockResolvedValue({ id: 'payment' }) },
    invoice: {
      create: vi.fn().mockResolvedValue({ id: 'invoice', status: 'PAID' }),
    },
  }
  mocks.transaction.mockImplementation((fn: any) => fn(tx))
})
it('uses coach-specific shares and gives all extra participant fees to the coach', () => {
  expect(priceInHouseHour(terms, 3)).toEqual({
    courtAmount: 250000,
    coachAmount: 650000,
    extraAmount: 200000,
  })
  expect(
    priceInHouseHour(
      { ...terms, hourlyPrice: 800000, courtHourlyShare: 200000 },
      1,
    ),
  ).toEqual({ courtAmount: 200000, coachAmount: 600000, extraAmount: 0 })
})
it.each([0, 1.5, 101])('rejects invalid participant count %s', (count) =>
  expect(() => priceInHouseHour(terms, count)).toThrow(),
)
it('validates every package tier and rejects invalid financial terms', () => {
  for (const hours of [1, 2, 5, 7, 10, 12, 24])
    expect(
      inHousePlanSchema.safeParse({
        staffId: 'andi',
        name: 'Paket',
        hours,
        ...terms,
      }).success,
    ).toBe(true)
  expect(
    inHousePlanSchema.safeParse({
      staffId: 'andi',
      name: 'Paket',
      hours: 5,
      ...terms,
      courtHourlyShare: 950000,
    }).success,
  ).toBe(false)
  expect(
    inHousePlanSchema.safeParse({
      staffId: 'andi',
      name: 'Paket',
      hours: 5,
      ...terms,
      extraParticipantHourlyPrice: 50000,
    }).success,
  ).toBe(false)
})
it('covers the full peak court payment and charges only extras, storing a 250k court allocation', async () => {
  const result = await redeemInHouseSelections(tx, input())
  expect(result).toEqual({
    coveredCourtAmount: 300000,
    courtPriceAdjustment: 50000,
    extraAmount: 200000,
  })
  expect(tx.inHouseWallet.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: 'wallet',
        deletedAt: null,
        userId: 'customer',
        invoice: { status: 'PAID' },
      },
    }),
  )
  expect(tx.inHouseWallet.updateMany).toHaveBeenCalledWith({
    where: { id: 'wallet', userId: 'customer', remainingMinutes: { gte: 60 } },
    data: { remainingMinutes: { decrement: 60 } },
  })
  expect(tx.bookingCoach.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        price: 200000,
        courtSlotId: 'court-slot',
        inHouseUsage: {
          create: expect.objectContaining({
            minutes: 60,
            participants: 3,
            courtAmount: 250000,
            coachAmount: 650000,
            extraAmount: 200000,
          }),
        },
      }),
    }),
  )
})
it('fully covers a one-participant session without another payment', async () => {
  expect(
    await redeemInHouseSelections(tx, {
      ...input(),
      selections: [{ ...selection, participants: 1 }],
    }),
  ).toMatchObject({ coveredCourtAmount: 300000, extraAmount: 0 })
})
it.each([
  'wrong coach',
  'wrong branch',
  'wrong time',
  'wrong sport',
  'another customer',
  'insufficient quota',
])('rejects %s before saving usage', async (reason) => {
  if (reason === 'wrong coach') tx.slot.findFirst.mockResolvedValue(null)
  if (reason === 'wrong branch')
    tx.slot.findFirst.mockResolvedValue({ branchId: 'other', ...range })
  if (reason === 'wrong time')
    tx.slot.findFirst.mockResolvedValue({
      branchId: 'cemara',
      startAt: range.startAt,
      endAt: new Date(+range.endAt + 3600000),
    })
  if (reason === 'wrong sport')
    tx.inHouseWallet.findFirst.mockResolvedValue({
      id: 'wallet',
      staffId: 'andi',
      branchId: 'cemara',
      staff: { isActive: true, role: 'COACH', coachType: 'TENNIS' },
      ...terms,
    })
  if (reason === 'another customer')
    tx.inHouseWallet.findFirst.mockResolvedValue(null)
  if (reason === 'insufficient quota')
    tx.inHouseWallet.updateMany.mockResolvedValue({ count: 0 })
  await expect(redeemInHouseSelections(tx, input())).rejects.toThrow()
  expect(tx.bookingCoach.create).not.toHaveBeenCalled()
})
it('rejects simultaneous club coaching so the club discount cannot be stacked', async () => {
  await expect(
    redeemInHouseSelections(tx, { ...input(), clubCoachSlots: [range] }),
  ).rejects.toThrow(/club/)
  expect(tx.inHouseWallet.updateMany).not.toHaveBeenCalled()
})
it('rejects duplicated coverage before claiming a coach', async () => {
  await expect(
    redeemInHouseSelections(tx, {
      ...input(),
      selections: [selection, selection],
    }),
  ).rejects.toThrow()
  expect(mocks.claim).not.toHaveBeenCalled()
})
it('restores the quota only once even when cancellation is retried', async () => {
  tx.inHouseUsage.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 0 })
  await restoreInHouseUsage(tx, 'usage')
  await restoreInHouseUsage(tx, 'usage')
  expect(tx.inHouseWallet.update).toHaveBeenCalledTimes(1)
  expect(tx.inHouseWallet.update).toHaveBeenCalledWith({
    where: { id: 'wallet' },
    data: { remainingMinutes: { increment: 60 } },
  })
})
it('sells five prepaid hours with frozen terms and a paid invoice', async () => {
  tx.inHouseWallet.findFirst.mockResolvedValue(null)
  const result = await sellInHousePlan(
    {
      userId: 'customer',
      packageId: 'plan',
      paymentMethodId: 'cash',
      requestId: 'request',
    },
    'cashier',
  )
  expect(tx.inHouseWallet.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        totalMinutes: 300,
        remainingMinutes: 300,
        ...terms,
        staffId: 'andi',
      }),
    }),
  )
  expect(tx.invoice.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        total: 4500000,
        status: 'PAID',
        inHouseWalletId: 'wallet',
      }),
    }),
  )
  expect(result.invoice?.status).toBe('PAID')
})
it('a retried sale does not issue another invoice or create more quota', async () => {
  tx.inHouseWallet.findFirst.mockResolvedValue({
    id: 'existing',
    userId: 'customer',
    packageId: 'plan',
  })
  expect(
    (
      await sellInHousePlan(
        {
          userId: 'customer',
          packageId: 'plan',
          paymentMethodId: 'cash',
          requestId: 'request',
        },
        'cashier',
      )
    ).id,
  ).toBe('existing')
  expect(tx.inHouseWallet.create).not.toHaveBeenCalled()
  expect(tx.payment.create).not.toHaveBeenCalled()
})
it('rejects inactive offline payment methods without issuing quota', async () => {
  tx.inHouseWallet.findFirst.mockResolvedValue(null)
  tx.paymentMethod.findFirst.mockResolvedValue(null)
  await expect(
    sellInHousePlan(
      {
        userId: 'customer',
        packageId: 'plan',
        paymentMethodId: 'disabled',
        requestId: 'request',
      },
      'cashier',
    ),
  ).rejects.toThrow()
  expect(tx.inHouseWallet.create).not.toHaveBeenCalled()
})
it('does not allow transferring a plan to another coach', async () => {
  await expect(
    saveInHousePlan('plan', {
      staffId: 'awam',
      name: 'Paket',
      hours: 5,
      ...terms,
      extraParticipantHourlyPrice: 100000,
      isActive: true,
    }),
  ).rejects.toThrow(/Coach paket/)
})

it.each([1, 3])(
  'charges a single-hour tariff for %s participants without debiting prepaid quota',
  async (participants) => {
    tx.inHousePlan.findFirst.mockResolvedValue({
      id: 'single',
      hours: 1,
      name: 'Andi satuan',
      staffId: 'andi',
      branchId: 'cemara',
      hourlyPrice: 1000000,
      courtHourlyShare: 250000,
      extraParticipantHourlyPrice: 100000,
      staff: { isActive: true, role: 'COACH', coachType: 'PADEL' },
    })
    const result = await redeemInHouseSelections(tx, {
      ...input(),
      selections: [
        {
          planId: 'single',
          courtSlotId: 'court-slot',
          coachSlotId: 'coach-slot',
          participants,
        },
      ],
    })
    expect(result).toEqual({
      coveredCourtAmount: 300000,
      courtPriceAdjustment: 50000,
      extraAmount: 1000000 + (participants - 1) * 100000,
    })
    expect(tx.inHousePlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'single', hours: 1, isActive: true },
      }),
    )
    expect(tx.inHouseWallet.updateMany).not.toHaveBeenCalled()
    expect(tx.bookingCoach.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        price: 750000 + (participants - 1) * 100000,
      }),
    })
    expect(tx.bookingCoach.create.mock.calls[0][0].data).not.toHaveProperty(
      'inHouseUsage',
    )
  },
)
it('rejects an inactive or non-single-hour plan before recording a direct session', async () => {
  tx.inHousePlan.findFirst.mockResolvedValue(null)
  await expect(
    redeemInHouseSelections(tx, {
      ...input(),
      selections: [
        {
          planId: 'five-hour',
          courtSlotId: 'court-slot',
          coachSlotId: 'coach-slot',
          participants: 1,
        },
      ],
    }),
  ).rejects.toThrow()
  expect(tx.bookingCoach.create).not.toHaveBeenCalled()
})
it('does not accept browser prices or combine a wallet with a single tariff', () => {
  const direct = {
    planId: 'single',
    courtSlotId: 'court',
    coachSlotId: 'coach',
    participants: 1,
  }
  expect(inHouseSelectionSchema.safeParse(direct).success).toBe(true)
  expect(
    inHouseSelectionSchema.safeParse({ ...direct, hourlyPrice: 1 }).success,
  ).toBe(false)
  expect(
    inHouseSelectionSchema.safeParse({ ...direct, walletId: 'wallet' }).success,
  ).toBe(false)
})

it('deletes an unused wallet while keeping its sale and invoice', async () => {
  tx.inHouseWallet.findFirst.mockResolvedValue({
    id: 'wallet',
    totalMinutes: 300,
    remainingMinutes: 300,
    deletedAt: null,
    _count: { usages: 0 },
  })
  await expect(deleteUnusedInHouseWallet('wallet', 'cashier')).resolves.toEqual(
    { id: 'wallet' },
  )
  expect(tx.$queryRaw).toHaveBeenCalled()
  expect(tx.inHouseWallet.update).toHaveBeenCalledWith({
    where: { id: 'wallet' },
    data: { deletedAt: expect.any(Date), deletedById: 'cashier' },
  })
  expect(tx.invoice.create).not.toHaveBeenCalled()
  expect(tx.payment.create).not.toHaveBeenCalled()
})
it.each([
  { remainingMinutes: 240, usages: 1 },
  { remainingMinutes: 300, usages: 1 },
])(
  'rejects used wallets even after quota was restored: %j',
  async ({ remainingMinutes, usages }) => {
    tx.inHouseWallet.findFirst.mockResolvedValue({
      totalMinutes: 300,
      remainingMinutes,
      _count: { usages },
    })
    await expect(
      deleteUnusedInHouseWallet('wallet', 'cashier'),
    ).rejects.toThrow(/pernah dipakai/)
    expect(tx.inHouseWallet.update).not.toHaveBeenCalled()
  },
)
it('rejects a wallet outside the selected branch or missing', async () => {
  tx.inHouseWallet.findFirst.mockResolvedValue(null)
  await expect(deleteUnusedInHouseWallet('missing', 'cashier')).rejects.toThrow(
    /tidak ditemukan/,
  )
})
it('retries deletion without changing the original actor or time', async () => {
  tx.inHouseWallet.findFirst.mockResolvedValue({ deletedAt: new Date() })
  await deleteUnusedInHouseWallet('wallet', 'other')
  expect(tx.inHouseWallet.update).not.toHaveBeenCalled()
})
it('does not revive a deleted wallet when its sale is retried', async () => {
  tx.inHouseWallet.findFirst.mockResolvedValue({
    userId: 'customer',
    packageId: 'plan',
    deletedAt: new Date(),
  })
  await expect(
    sellInHousePlan(
      {
        userId: 'customer',
        packageId: 'plan',
        paymentMethodId: 'cash',
        requestId: 'request',
      },
      'cashier',
    ),
  ).rejects.toThrow(/sudah dihapus/)
  expect(tx.inHouseWallet.create).not.toHaveBeenCalled()
})

it('only accepts active in-house coaches when configuring a tariff', async () => {
  tx.staff.findFirst.mockResolvedValue(null)
  await expect(
    saveInHousePlan(undefined, {
      staffId: 'club-coach',
      name: 'Paket',
      hours: 5,
      ...terms,
      extraParticipantHourlyPrice: 100000,
      isActive: true,
    }),
  ).rejects.toThrow(/Coach in-house aktif/)
  expect(tx.staff.findFirst).toHaveBeenCalledWith({
    where: {
      id: 'club-coach',
      role: 'COACH',
      isActive: true,
      isInHouseCoach: true,
    },
  })
  expect(tx.inHousePlan.create).not.toHaveBeenCalled()
})

const separateRule = {
  branchId: 'cemara',
  sport: 'PADEL',
  effectiveFrom: '2030-01-01',
  happyStart: 0,
  happyEnd: 15,
  peakStart: 15,
  peakEnd: 24,
  happyInHouseCoachDiscount: 20000,
  peakInHouseCoachDiscount: 20000,
  happyCoachDiscount: 999999,
  peakCoachDiscount: 999999,
}
it.each([0, 20000, 500000])(
  'preserves prepaid package pricing regardless of hourly discount %s',
  async (discount) => {
    const result = await redeemInHouseSelections(tx, {
      ...input(),
      tariffRules: [
        {
          ...separateRule,
          inHouseCourtHourlyPrice: 123456,
          happyInHouseCoachDiscount: discount,
          peakInHouseCoachDiscount: discount,
        },
      ],
    })
    expect(result.coveredCourtAmount).toBe(300000)
    expect(result.extraAmount).toBe(200000)
    expect(tx.bookingDetail.update).toHaveBeenCalledWith({
      where: { id: 'detail' },
      data: { discountPrice: 250000 },
    })
    expect(
      tx.bookingCoach.create.mock.calls[0][0].data.inHouseUsage.create,
    ).toMatchObject({ courtAmount: 250000, coachAmount: 650000 })
  },
)
it('charges the coach share plus discounted court for direct coaching', async () => {
  tx.inHousePlan.findFirst.mockResolvedValue({
    id: 'plan',
    staffId: 'andi',
    branchId: 'cemara',
    hours: 1,
    ...terms,
    staff: { isActive: true, role: 'COACH', coachType: 'PADEL' },
  })
  const result = await redeemInHouseSelections(tx, {
    ...input(),
    tariffRules: [separateRule],
    selections: [
      {
        planId: 'plan',
        courtSlotId: 'court-slot',
        coachSlotId: 'coach-slot',
        participants: 1,
      },
    ],
  })
  expect(result.coveredCourtAmount).toBe(20000)
  expect(result.extraAmount).toBe(650000)
  expect(300000 - result.coveredCourtAmount + result.extraAmount).toBe(930000)
  expect(tx.bookingCoach.create.mock.calls[0][0].data.price).toBe(650000)
})

it.each([0, -1, 1.5, 35791395])('rejects invalid package quota %s', (hours) => {
  expect(
    inHousePlanSchema.safeParse({
      staffId: 'andi',
      name: 'Paket',
      hours,
      ...terms,
    }).success,
  ).toBe(false)
})

it.each([150000, 300000])(
  'charges fixed 250k court plus scheduled coach for a normal court price of %s without a package',
  async (courtPrice) => {
    tx.slot.findMany = vi.fn().mockResolvedValue([
      {
        id: 'coach-slot',
        staffId: 'andi',
        branchId: 'cemara',
        price: 400000,
        ...range,
        staff: {
          id: 'andi',
          isActive: true,
          role: 'COACH',
          coachType: 'PADEL',
          isInHouseCoach: true,
        },
      },
    ])
    const court = await tx.bookingDetail.findFirst()
    tx.bookingDetail.findFirst.mockResolvedValue({
      ...court,
      discountPrice: courtPrice,
    })
    const result = await redeemInHouseSelections(tx, {
      ...input(),
      selections: [
        {
          staffId: 'andi',
          courtSlotId: 'court-slot',
          coachSlotId: 'coach-slot',
          participants: 1,
        },
      ],
      tariffRules: [{ ...separateRule, inHouseCourtHourlyPrice: 250000 }],
    })
    expect(result).toEqual({
      coveredCourtAmount: courtPrice - 250000,
      courtPriceAdjustment: courtPrice - 250000,
      extraAmount: 400000,
    })
    expect(courtPrice - result.coveredCourtAmount + result.extraAmount).toBe(
      650000,
    )
    expect(tx.bookingDetail.update).toHaveBeenCalledWith({
      where: { id: 'detail' },
      data: { discountPrice: 250000 },
    })
    expect(tx.inHouseWallet.updateMany).not.toHaveBeenCalled()
    expect(tx.inHousePlan.findFirst).not.toHaveBeenCalled()
  },
)
it('rejects a direct scheduled coach that is not an active in-house coach', async () => {
  tx.slot.findMany = vi.fn().mockResolvedValue([])
  await expect(
    redeemInHouseSelections(tx, {
      ...input(),
      selections: [
        {
          staffId: 'club',
          courtSlotId: 'court-slot',
          coachSlotId: 'coach-slot',
          participants: 1,
        },
      ],
    }),
  ).rejects.toThrow(/tidak tersedia/)
})

it.each([1, 2, 3])(
  'charges the full scheduled price per hour and separate extras for %s participants with reversed choices',
  async (participants) => {
    const first = {
      id: 'coach-slot',
      staffId: 'andi',
      branchId: 'cemara',
      price: 750000,
      additionalHourPrice: 100000,
      ...range,
      staff: {
        isActive: true,
        role: 'COACH',
        coachType: 'PADEL',
        isInHouseCoach: true,
      },
    }
    const second = {
      ...first,
      id: 'coach-second',
      startAt: range.endAt,
      endAt: new Date(+range.endAt + 3600000),
    }
    tx.slot.findMany = vi.fn().mockResolvedValue([second, first])
    tx.slot.findFirst.mockImplementation(({ where }: any) =>
      where.id === second.id ? second : first,
    )
    tx.bookingDetail.findFirst.mockImplementation(({ where }: any) => {
      const slot = where.slotId === 'court-second' ? second : first
      return {
        id: `detail-${where.slotId}`,
        slotId: where.slotId,
        discountPrice: 300000,
        slot: { ...slot, id: where.slotId, court: { sport: 'PADEL' } },
      }
    })
    const result = await redeemInHouseSelections(tx, {
      ...input(),
      courtSlotIds: ['court-slot', 'court-second'],
      selections: [
        {
          staffId: 'andi',
          coachSlotId: second.id,
          courtSlotId: 'court-second',
          participants,
        },
        {
          staffId: 'andi',
          coachSlotId: first.id,
          courtSlotId: 'court-slot',
          participants,
        },
      ],
      tariffRules: [{ ...separateRule, inHouseCourtHourlyPrice: 250000 }],
    })
    expect(result).toEqual({
      coveredCourtAmount: 100000,
      courtPriceAdjustment: 100000,
      extraAmount: 1500000 + (participants - 1) * 200000,
    })
    expect(tx.bookingCoach.create).toHaveBeenCalledTimes(2)
    for (const call of tx.bookingCoach.create.mock.calls) {
      expect(call[0].data.price).toBe(750000 + (participants - 1) * 100000)
    }
    expect(600000 - result.coveredCourtAmount + result.extraAmount).toBe(
      2000000 + (participants - 1) * 200000,
    )
  },
)

it('uses the normal court price when fixed pricing is disabled, without reusing legacy discounts', async () => {
  tx.slot.findMany = vi.fn().mockResolvedValue([
    {
      id: 'coach-slot',
      staffId: 'andi',
      branchId: 'cemara',
      price: 400000,
      ...range,
      staff: {
        isActive: true,
        role: 'COACH',
        coachType: 'PADEL',
        isInHouseCoach: true,
      },
    },
  ])
  const result = await redeemInHouseSelections(tx, {
    ...input(),
    selections: [
      {
        staffId: 'andi',
        courtSlotId: 'court-slot',
        coachSlotId: 'coach-slot',
        participants: 1,
      },
    ],
    tariffRules: [{ ...separateRule, inHouseCourtHourlyPrice: null }],
  })
  expect(result).toEqual({
    coveredCourtAmount: 0,
    courtPriceAdjustment: 0,
    extraAmount: 400000,
  })
})
it('accepts a scheduled coach identity but rejects browser prices and mixed package identities', () => {
  const direct = {
    staffId: 'andi',
    courtSlotId: 'court',
    coachSlotId: 'coach',
    participants: 1,
  }
  expect(inHouseSelectionSchema.safeParse(direct).success).toBe(true)
  expect(
    inHouseSelectionSchema.safeParse({ ...direct, hourlyPrice: 1 }).success,
  ).toBe(false)
  expect(
    inHouseSelectionSchema.safeParse({ ...direct, walletId: 'wallet' }).success,
  ).toBe(false)
})
