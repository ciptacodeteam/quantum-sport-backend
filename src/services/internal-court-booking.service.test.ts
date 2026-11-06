import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  slots: vi.fn(),
  claim: vi.fn(),
  create: vi.fn(),
  user: vi.fn(),
  createUser: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ db: { $transaction: mocks.transaction } }))
vi.mock('./slot-claim.service', () => ({ claimSlotsAtomically: mocks.claim }))
vi.mock('@/lib/utils', () => ({ formatPhone: async () => '628123456789' }))
import {
  createInternalCourtBooking,
  internalCourtBookingSchema,
} from './internal-court-booking.service'

const input = {
  purpose: 'COACH_TRAINING' as const,
  activityName: 'Coach Andi',
  userId: 'customer',
  courtSlots: ['slot-1'],
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T09:00:00+07:00'))
  mocks.slots.mockResolvedValue([
    {
      id: 'slot-1',
      courtId: 'court-1',
      price: 250000,
      discountPrice: 200000,
      startAt: new Date('2026-11-06T12:00:00Z'),
    },
  ])
  mocks.user.mockResolvedValue({ id: 'customer' })
  mocks.create.mockImplementation(async ({ data }) => ({
    id: 'booking-1',
    ...data,
  }))
  // Deliberately no invoice/payment/membership delegates: creation must not use them.
  mocks.transaction.mockImplementation(async (fn) =>
    fn({
      slot: { findMany: mocks.slots },
      user: { findUnique: mocks.user, create: mocks.createUser },
      booking: { create: mocks.create },
    }),
  )
})
afterEach(() => vi.useRealTimers())

it.each(['COACH_TRAINING', 'EVENT'] as const)(
  'confirms %s with zero value and no financial records',
  async (purpose) => {
    const booking = await createInternalCourtBooking(
      { ...input, purpose },
      'cashier',
    )
    expect(booking).toMatchObject({
      purpose,
      activityName: 'Coach Andi',
      status: 'CONFIRMED',
      cashierId: 'cashier',
      totalPrice: 0,
      processingFee: 0,
      courtNormalPrice: 0,
      courtDiscountPrice: 0,
      details: {
        create: [
          { slotId: 'slot-1', courtId: 'court-1', price: 0, discountPrice: 0 },
        ],
      },
    })
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        slotIds: ['slot-1'],
        type: 'COURT',
        startsAfter: new Date('2026-11-06T08:45:00Z'),
      }),
    )
    expect(mocks.create.mock.calls[0][0].data).not.toHaveProperty('invoice')
    expect(mocks.create.mock.calls[0][0].data).not.toHaveProperty(
      'membershipUserId',
    )
  },
)

it('does not save a booking if a concurrent checkout wins the slot', async () => {
  mocks.claim.mockRejectedValue(new Error('Slot sudah dipesan'))
  await expect(createInternalCourtBooking(input, 'cashier')).rejects.toThrow(
    'Slot sudah dipesan',
  )
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.createUser).not.toHaveBeenCalled()
})

it('rejects slots outside this branch or unavailable slots', async () => {
  mocks.slots.mockResolvedValue([])
  await expect(createInternalCourtBooking(input, 'cashier')).rejects.toThrow(
    'tidak tersedia',
  )
  expect(mocks.claim).not.toHaveBeenCalled()
  expect(mocks.create).not.toHaveBeenCalled()
})

it('rejects a slot at the exact end of its 15-minute grace period', async () => {
  vi.setSystemTime(new Date('2026-11-06T12:15:00+07:00'))
  await expect(createInternalCourtBooking(input, 'cashier')).rejects.toThrow(
    '15 menit',
  )
  expect(mocks.claim).not.toHaveBeenCalled()
})

it('deduplicates selected slots before claiming and saving', async () => {
  await createInternalCourtBooking(
    { ...input, courtSlots: ['slot-1', 'slot-1'] },
    'cashier',
  )
  expect(mocks.claim.mock.calls[0][1].slotIds).toEqual(['slot-1'])
  expect(mocks.create.mock.calls[0][0].data.details.create).toHaveLength(1)
})

it('supports the same walk-in identity flow without requiring payment', async () => {
  mocks.user.mockResolvedValue(null)
  mocks.createUser.mockResolvedValue({ id: 'walk-in' })
  await createInternalCourtBooking(
    { ...input, userId: undefined, name: 'Andi', phone: '08123456789' },
    'cashier',
  )
  expect(mocks.createUser).toHaveBeenCalledWith(
    expect.objectContaining({
      data: {
        name: 'Andi',
        phone: '628123456789',
        source: 'WALK_IN',
        password: null,
      },
    }),
  )
  expect(mocks.create.mock.calls[0][0].data.userId).toBe('walk-in')
})

it('requires a valid purpose, activity and selected slots; rejects financial overrides', () => {
  for (const change of [
    { purpose: 'REGULAR' },
    { activityName: '   ' },
    { courtSlots: [] },
    { userId: undefined, name: 'Andi' },
    { userId: undefined, phone: '08123456789' },
    { totalPrice: 100000 },
    { paymentMethodId: 'cash' },
  ])
    expect(
      internalCourtBookingSchema.safeParse({ ...input, ...change }).success,
    ).toBe(false)
  expect(
    internalCourtBookingSchema.parse({ ...input, activityName: ' Coach Andi ' })
      .activityName,
  ).toBe('Coach Andi')
})

it.each(['COACH_TRAINING', 'EVENT'] as const)(
  'saves %s without creating or requiring a customer',
  async (purpose) => {
    const payload = internalCourtBookingSchema.parse({
      ...input,
      userId: undefined,
      purpose,
    })
    const booking = await createInternalCourtBooking(payload, 'cashier')
    expect(booking).toMatchObject({
      userId: null,
      purpose,
      status: 'CONFIRMED',
      totalPrice: 0,
    })
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.createUser).not.toHaveBeenCalled()
  },
)
