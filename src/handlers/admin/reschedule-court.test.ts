import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  slot: vi.fn(),
  updateSlot: vi.fn(),
  updateDetail: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        bookingDetail: { findUnique: mocks.detail, update: mocks.updateDetail },
        slot: { findUnique: mocks.slot, update: mocks.updateSlot },
      }),
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
      status: 'CONFIRMED',
      coaches: [],
      invoice: null,
      totalPrice: 150000,
    },
  })
  mocks.slot.mockResolvedValue(newSlot)
  mocks.updateSlot.mockResolvedValue({})
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
