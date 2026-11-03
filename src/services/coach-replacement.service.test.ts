import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  tx: {} as any,
  context: vi.fn(),
  slots: vi.fn(),
  claim: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    bookingCoach: { findFirst: mocks.context },
    slot: { findMany: mocks.slots },
    $transaction: (fn: any) => fn(mocks.tx),
  },
}))
vi.mock('./slot-claim.service', () => ({ claimSlotsAtomically: mocks.claim }))
import {
  availableCoachReplacements,
  replaceBookedCoach,
} from './coach-replacement.service'
const now = new Date('2026-11-01T05:00:00Z')
const startAt = new Date('2026-11-02T13:00:00Z')
const endAt = new Date('2026-11-02T14:00:00Z')
let current: any
let replacement: any
beforeEach(() => {
  vi.clearAllMocks()
  current = {
    id: 'item',
    bookingId: 'service',
    slotId: 'old-slot',
    status: 'CONFIRMED',
    price: 150000,
    slot: {
      id: 'old-slot',
      staffId: 'old-staff',
      startAt,
      endAt,
      staff: { name: 'Coach Lama', coachType: 'TENNIS' },
    },
    courtSlot: { court: { sport: 'TENNIS' } },
    booking: {
      branchId: 'cemara',
      status: 'CONFIRMED',
      serviceForBookingId: 'court-booking',
      serviceForBooking: { status: 'CONFIRMED' },
      adminNote: 'Catatan lama',
      details: [],
    },
  }
  replacement = {
    id: 'new-slot',
    staffId: 'new-staff',
    type: 'COACH',
    price: 150000,
    startAt,
    endAt,
    staff: {
      name: 'Coach Baru',
      isActive: true,
      role: 'COACH',
      coachType: 'TENNIS',
    },
  }
  mocks.context.mockImplementation(async () => current)
  mocks.slots.mockResolvedValue([])
  mocks.claim.mockResolvedValue(undefined)
  mocks.tx = {
    bookingCoach: {
      findFirst: mocks.context,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    slot: {
      findFirst: vi
        .fn()
        .mockImplementation(async ({ select }) =>
          select ? { staffId: replacement.staffId } : replacement,
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    booking: { update: vi.fn() },
    $queryRaw: vi.fn(),
  }
})
const change = () =>
  replaceBookedCoach(
    'item',
    { slotId: 'new-slot', expectedSlotId: 'old-slot', reason: 'Berhalangan' },
    'admin',
    now,
  )
it('claims the new coach first, moves the existing service row, and safely releases the old slot without changing billing', async () => {
  expect(await change()).toEqual({
    id: 'item',
    bookingId: 'service',
    name: 'Coach Baru',
    slotId: 'new-slot',
    price: 150000,
  })
  expect(mocks.claim).toHaveBeenCalledWith(
    mocks.tx,
    expect.objectContaining({ slotIds: ['new-slot'], type: 'COACH' }),
  )
  expect(mocks.tx.bookingCoach.updateMany).toHaveBeenCalledWith({
    where: { id: 'item', slotId: 'old-slot', status: 'CONFIRMED' },
    data: { slotId: 'new-slot' },
  })
  const release = mocks.tx.slot.updateMany.mock.calls[0][0]
  expect(release.where).toMatchObject({
    id: 'old-slot',
    scheduleClosed: false,
    bookingCoaches: { none: { status: { not: 'CANCELLED' } } },
  })
  expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.tx.bookingCoach.updateMany.mock.invocationCallOrder[0],
  )
  expect(
    mocks.tx.bookingCoach.updateMany.mock.invocationCallOrder[0],
  ).toBeLessThan(mocks.tx.slot.updateMany.mock.invocationCallOrder[0])
  const note = mocks.tx.booking.update.mock.calls[0][0].data.adminNote
  expect(note).toContain('Catatan lama\n')
  for (const text of ['Coach Lama', 'Coach Baru', 'admin', 'Berhalangan'])
    expect(note).toContain(text)
  expect(mocks.tx.booking.update.mock.calls[0][0].data).toEqual({
    adminNote: expect.any(String),
  })
})
it('does not release the old coach when the new slot is claimed by someone else', async () => {
  mocks.claim.mockRejectedValue(new Error('Coach sudah dipesan'))
  await expect(change()).rejects.toThrow('sudah dipesan')
  expect(mocks.tx.slot.updateMany).not.toHaveBeenCalled()
  expect(mocks.tx.bookingCoach.updateMany).not.toHaveBeenCalled()
})
it.each(['price', 'time', 'sport', 'inactive', 'role', 'same-coach'])(
  'rejects an incompatible replacement (%s)',
  async (kind) => {
    if (kind === 'price') replacement.price = 200000
    if (kind === 'time') replacement.endAt = new Date(+endAt + 3600000)
    if (kind === 'sport') replacement.staff.coachType = 'PADEL'
    if (kind === 'inactive') replacement.staff.isActive = false
    if (kind === 'role') replacement.staff.role = 'BALLBOY'
    if (kind === 'same-coach') replacement.staffId = 'old-staff'
    await expect(change()).rejects.toThrow()
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.tx.slot.updateMany).not.toHaveBeenCalled()
  },
)
it.each(['HOLD', 'CANCELLED'])('rejects a %s coach booking', async (status) => {
  current.status = status
  await expect(change()).rejects.toThrow('terkonfirmasi')
  expect(mocks.claim).not.toHaveBeenCalled()
})
it('rechecks the current assignment after locking to prevent a stale dialog overwriting another admin', async () => {
  mocks.context
    .mockResolvedValueOnce(current)
    .mockResolvedValue({ ...current, slotId: 'changed-slot' })
  await expect(change()).rejects.toThrow('sudah diubah')
  expect(mocks.claim).not.toHaveBeenCalled()
})
it('rejects a cancelled parent court booking and expired hours', async () => {
  current.booking.serviceForBooking.status = 'CANCELLED'
  await expect(change()).rejects.toThrow('terkonfirmasi')
  current.booking.serviceForBooking.status = 'CONFIRMED'
  current.slot.startAt = now
  await expect(change()).rejects.toThrow('15 menit')
})
it('rejects an inaccessible booking before any locks or claims', async () => {
  mocks.context.mockResolvedValue(null)
  await expect(change()).rejects.toThrow('cabang')
  expect(mocks.tx.$queryRaw).not.toHaveBeenCalled()
  expect(mocks.claim).not.toHaveBeenCalled()
})
it('offers matching slot prices and intervals in the same branch, excluding busy people on overlapping slot IDs', async () => {
  mocks.slots
    .mockResolvedValueOnce([
      { ...replacement, staffId: 'free' },
      { ...replacement, id: 'other', staffId: 'busy' },
    ])
    .mockResolvedValueOnce([{ staffId: 'busy' }])
  const result = await availableCoachReplacements('item', now)
  expect(mocks.slots.mock.calls[0][0].where).toMatchObject({
    branchId: 'cemara',
    type: 'COACH',
    price: 150000,
    startAt,
    endAt,
    isAvailable: true,
    scheduleClosed: false,
    staff: {
      role: 'COACH',
      isActive: true,
      AND: [{ coachType: { in: ['TENNIS', 'PADEL_TENNIS'] } }],
    },
  })
  expect(result.options.map((s) => s.staffId)).toEqual(['free'])
  expect(result.current.slotId).toBe('old-slot')
})
