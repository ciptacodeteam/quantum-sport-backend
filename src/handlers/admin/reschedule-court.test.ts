import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  slot: vi.fn(),
  updateSlot: vi.fn(),
  claimSlot: vi.fn(),
  transaction: vi.fn(),
  updateDetail: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    $transaction: (fn: (tx: unknown) => unknown, options?: unknown) => {
      mocks.transaction(options)
      return fn({
        bookingDetail: { findUnique: mocks.detail, update: mocks.updateDetail },
        slot: {
          findUnique: mocks.slot,
          update: mocks.updateSlot,
          updateMany: mocks.claimSlot,
        },
      })
    },
  },
}))
import { rescheduleCourtBookingHandler } from './booked-court.handler'

function setup(source: 'PADEL' | 'TENNIS', target: 'PADEL' | 'TENNIS') {
  const oldSlot = {
    id: 'old',
    court: { sport: source },
    startAt: new Date('2040-01-05T02:00:00Z'),
    endAt: new Date('2040-01-05T03:00:00Z'),
  }
  const newSlot = {
    id: 'new',
    type: 'COURT',
    courtId: 'target-court',
    court: { sport: target, branchId: 'cemara', isActive: true },
    price: 150000,
    isAvailable: true,
    startAt: new Date('2040-01-06T02:00:00Z'),
    endAt: new Date('2040-01-06T03:00:00Z'),
  }
  mocks.detail.mockResolvedValue({
    id: 'detail',
    slotId: 'old',
    price: 150000,
    slot: oldSlot,
    court: { sport: source },
    booking: {
      id: 'booking',
      branchId: 'cemara',
      status: 'CONFIRMED',
      coaches: [],
      invoice: null,
      totalPrice: 150000,
    },
  })
  mocks.slot.mockResolvedValue(newSlot)
  mocks.updateSlot.mockResolvedValue({})
  mocks.claimSlot.mockResolvedValue({ count: 1 })
  mocks.updateDetail.mockResolvedValue({
    id: 'detail',
    slot: newSlot,
    court: newSlot.court,
    price: 150000,
  })
}
beforeEach(() => vi.clearAllMocks())
const execute = () =>
  (rescheduleCourtBookingHandler[2] as any)({
    req: {
      valid: (key: string) =>
        key === 'param' ? { id: 'detail' } : { newSlotId: 'new' },
    },
    var: { logger: { fatal: vi.fn() } },
    json: (body: unknown, status: number) => ({ body, status }),
  })

it.each([
  ['PADEL', 'TENNIS'],
  ['TENNIS', 'PADEL'],
] as const)(
  'rejects %s to %s before changing any booking or slot',
  async (source, target) => {
    setup(source, target)
    await expect(execute()).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('olahraga yang sama'),
    })
    expect(mocks.updateSlot).not.toHaveBeenCalled()
    expect(mocks.updateDetail).not.toHaveBeenCalled()
  },
)
it.each(['PADEL', 'TENNIS'] as const)(
  'allows %s rescheduling to the same sport',
  async (sport) => {
    setup(sport, sport)
    expect((await execute()).status).toBe(200)
    expect(mocks.updateDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { slotId: 'new', price: 150000, courtId: 'target-court' },
      }),
    )
  },
)
it('uses the original slot court when a legacy detail has no direct court relation', async () => {
  setup('PADEL', 'TENNIS')
  const detail = await mocks.detail()
  mocks.detail.mockResolvedValue({ ...detail, court: null })
  await expect(execute()).rejects.toMatchObject({ status: 400 })
  expect(mocks.updateSlot).not.toHaveBeenCalled()
})
it('rejects an unknown original sport without touching the booking', async () => {
  setup('PADEL', 'PADEL')
  const detail = await mocks.detail()
  mocks.detail.mockResolvedValue({
    ...detail,
    court: null,
    slot: { ...detail.slot, court: null },
  })
  await expect(execute()).rejects.toMatchObject({ status: 400 })
  expect(mocks.updateSlot).not.toHaveBeenCalled()
})

it('rejects a Tennis target outside Cemara without changing the original booking', async () => {
  setup('TENNIS', 'TENNIS')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({
    ...target,
    court: { sport: 'TENNIS', branchId: 's-parman', isActive: true },
  })
  await expect(execute()).rejects.toThrow(
    'Tennis hanya tersedia di cabang Cemara.',
  )
  expect(mocks.updateSlot).not.toHaveBeenCalled()
  expect(mocks.updateDetail).not.toHaveBeenCalled()
})

it.each([
  ['2040-01-03T02:00:00.000Z', true],
  ['2040-01-03T01:59:59.999Z', true],
  ['2040-01-03T02:00:00.001Z', false],
  ['2040-01-04T02:00:00.000Z', false],
  ['2040-01-05T02:00:00.000Z', false],
])('enforces H-2 directly in the admin API at %s', async (now, allowed) => {
  setup('PADEL', 'PADEL')
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
  try {
    if (allowed) expect((await execute()).status).toBe(200)
    else {
      await expect(execute()).rejects.toThrow('minimal 48 jam')
      expect(mocks.claimSlot).not.toHaveBeenCalled()
      expect(mocks.updateSlot).not.toHaveBeenCalled()
      expect(mocks.updateDetail).not.toHaveBeenCalled()
    }
  } finally {
    vi.useRealTimers()
  }
})

it.each(['HOLD', 'CANCELLED'])(
  'rejects rescheduling a %s booking',
  async (status) => {
    setup('PADEL', 'PADEL')
    const detail = await mocks.detail()
    mocks.detail.mockResolvedValue({
      ...detail,
      booking: { ...detail.booking, status },
    })
    await expect(execute()).rejects.toThrow('Hanya booking terkonfirmasi')
    expect(mocks.claimSlot).not.toHaveBeenCalled()
  },
)

it('rejects an unpaid invoice even if the booking status was changed to confirmed', async () => {
  setup('PADEL', 'PADEL')
  const detail = await mocks.detail()
  mocks.detail.mockResolvedValue({
    ...detail,
    booking: { ...detail.booking, invoice: { status: 'PENDING' } },
  })
  await expect(execute()).rejects.toThrow('Pembayaran harus lunas')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('rejects moving a booking to another branch', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({
    ...target,
    court: { ...target.court, branchId: 's-parman' },
  })
  await expect(execute()).rejects.toThrow('cabang yang sama')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('rejects changes in duration', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({
    ...target,
    endAt: new Date(target.endAt.getTime() + 3600000),
  })
  await expect(execute()).rejects.toThrow('Durasi jadwal pengganti')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('does not change a paid invoice amount during rescheduling', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({ ...target, price: 200000 })
  await expect(execute()).rejects.toThrow('harga yang sama')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('does not release the old slot when another request has claimed the target', async () => {
  setup('PADEL', 'PADEL')
  mocks.claimSlot.mockResolvedValue({ count: 0 })
  await expect(execute()).rejects.toThrow('baru saja dipesan')
  expect(mocks.updateSlot).not.toHaveBeenCalled()
  expect(mocks.updateDetail).not.toHaveBeenCalled()
  expect(mocks.claimSlot).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        isAvailable: true,
        bookingDetails: { none: { booking: { status: { not: 'CANCELLED' } } } },
      }),
    }),
  )
  expect(mocks.transaction).toHaveBeenCalledWith({
    isolationLevel: 'Serializable',
  })
})

it('rejects a target outside the membership package hours', async () => {
  setup('PADEL', 'PADEL')
  const detail = await mocks.detail()
  const target = await mocks.slot()
  mocks.detail.mockResolvedValue({
    ...detail,
    discountPrice: 0,
    booking: {
      ...detail.booking,
      membershipUserId: 'pack-user',
      membershipUser: { membership: { type: 'HAPPY_HOUR' } },
    },
  })
  mocks.slot.mockResolvedValue({
    ...target,
    startAt: new Date('2040-01-06T16:00:00+07:00'),
    endAt: new Date('2040-01-06T17:00:00+07:00'),
  })
  await expect(execute()).rejects.toThrow('ketentuan membership')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it.each([
  { isAvailable: false },
  { court: { sport: 'PADEL', branchId: 'cemara', isActive: false } },
  {
    startAt: new Date('2020-01-01T02:00:00Z'),
    endAt: new Date('2020-01-01T03:00:00Z'),
  },
])('rejects unavailable, inactive or elapsed targets %j', async (patch) => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({ ...target, ...patch })
  await expect(execute()).rejects.toMatchObject({ status: 400 })
  expect(mocks.claimSlot).not.toHaveBeenCalled()
  expect(mocks.updateSlot).not.toHaveBeenCalled()
})

it('allows an eligible membership move without changing a paid invoice total', async () => {
  setup('PADEL', 'PADEL')
  const detail = await mocks.detail()
  const target = await mocks.slot()
  mocks.detail.mockResolvedValue({
    ...detail,
    discountPrice: 0,
    booking: {
      ...detail.booking,
      membershipUserId: 'pack-user',
      courtDiscountPrice: 0,
      totalPrice: 0,
      invoice: { id: 'invoice', status: 'PAID', total: 0 },
      membershipUser: { membership: { type: 'ALL_HOUR' } },
    },
  })
  mocks.slot.mockResolvedValue({ ...target, price: 200000 })
  const result = await execute()
  expect(result.body.data.priceDifference).toBe(0)
  expect(result.body.data.updatedBooking.totalPrice).toBe(0)
})
