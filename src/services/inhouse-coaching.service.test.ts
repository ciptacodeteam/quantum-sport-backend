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
  redeemInHouseSelections,
  restoreInHouseUsage,
  sellInHousePlan,
  saveInHousePlan,
} from './inhouse-coaching.service'
import { inHousePlanSchema, priceInHouseHour } from '@/lib/inhouse-coaching'
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
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: 'andi',
          branchId: 'cemara',
          role: 'COACH',
          isActive: true,
        }),
    },
    inHousePlan: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
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
      findFirst: vi
        .fn()
        .mockResolvedValue({
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
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: 'coach-slot',
          staffId: 'andi',
          branchId: 'cemara',
          ...range,
        }),
    },
    bookingDetail: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
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
  for (const hours of [1, 5, 10])
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
      where: { id: 'wallet', userId: 'customer', invoice: { status: 'PAID' } },
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
