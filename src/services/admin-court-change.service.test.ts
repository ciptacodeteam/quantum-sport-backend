import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  wallet: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
  targets: vi.fn(),
  target: vi.fn(),
  slots: vi.fn(),
  move: vi.fn(),
  coach: vi.fn(),
  ballboy: vi.fn(),
  inventory: vi.fn(),
  booking: vi.fn(),
  lock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    $transaction: mocks.transaction,
    bookingDetail: { findFirst: mocks.detail },
    slot: { findMany: mocks.targets },
  },
}))
vi.mock('@/services/membership-renewal.service', () => ({
  lockCustomerWallet: mocks.wallet,
}))
import {
  changeAdminCourt,
  getAdminCourtChangeOptions,
} from './admin-court-change.service'

const now = new Date('2030-01-01T00:00:00+07:00')
const input = { sourceSlotId: 'old', newSlotId: 'new' }
const source = () => ({
  id: 'detail',
  bookingId: 'booking',
  slotId: 'old',
  price: 150000,
  discountPrice: 120000,
  slot: {
    id: 'old',
    type: 'COURT',
    courtId: 'a',
    startAt: new Date('2030-01-02T10:00:00Z'),
    endAt: new Date('2030-01-02T11:00:00Z'),
    court: { id: 'a', sport: 'TENNIS' },
  },
  booking: {
    id: 'booking',
    branchId: 'cemara',
    userId: 'me',
    status: 'CONFIRMED',
    purpose: 'REGULAR',
    membershipUserId: null,
    adminNote: 'Existing note',
    invoice: { status: 'PAID', total: 120000 },
  },
})
const target = () => ({
  id: 'new',
  courtId: 'b',
  court: { name: 'Court B' },
  price: 150000,
  discountPrice: 120000,
  startAt: source().slot.startAt,
  endAt: source().slot.endAt,
})
const execute = () => changeAdminCourt('admin', 'cemara', 'detail', input, now)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.detail.mockResolvedValue(source())
  mocks.target.mockResolvedValueOnce(target()).mockResolvedValue(null)
  mocks.slots.mockResolvedValue({ count: 1 })
  mocks.move.mockResolvedValue({ count: 1 })
  mocks.targets.mockResolvedValue([])
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: mocks.lock,
      bookingDetail: { findFirst: mocks.detail, updateMany: mocks.move },
      slot: { findFirst: mocks.target, updateMany: mocks.slots },
      bookingCoach: { updateMany: mocks.coach },
      bookingBallboy: { updateMany: mocks.ballboy },
      bookingInventory: { updateMany: mocks.inventory },
      booking: { update: mocks.booking },
    }),
  )
})
it('moves only the court, preserves paid amounts, relinks add-ons, and claims before releasing', async () => {
  expect(await execute()).toMatchObject({ slotId: 'new', courtName: 'Court B' })
  expect(mocks.wallet).toHaveBeenCalledWith(expect.anything(), 'me')
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: 'Serializable',
  })
  expect(mocks.detail).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'detail', booking: { branchId: 'cemara' } },
    }),
  )
  expect(mocks.target.mock.calls[0][0].where).toMatchObject({
    id: 'new',
    branchId: 'cemara',
    type: 'COURT',
    courtId: { not: 'a' },
    court: {
      isActive: true,
      branchId: 'cemara',
      sport: 'TENNIS',
      branch: { isActive: true },
    },
    startAt: source().slot.startAt,
    endAt: source().slot.endAt,
    scheduleClosed: false,
    isAvailable: true,
    bookingDetails: { none: { booking: { status: { not: 'CANCELLED' } } } },
  })
  expect(mocks.move).toHaveBeenCalledWith({
    where: { id: 'detail', bookingId: 'booking', slotId: 'old' },
    data: { slotId: 'new', courtId: 'b' },
  })
  expect(mocks.slots.mock.calls.map(([args]) => args.data)).toEqual([
    { isAvailable: false },
    { isAvailable: true },
  ])
  expect(mocks.slots.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.move.mock.invocationCallOrder[0],
  )
  expect(mocks.move.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.slots.mock.invocationCallOrder[1],
  )
  for (const dependency of [mocks.coach, mocks.ballboy]) {
    expect(dependency).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          courtSlotId: 'old',
          booking: {
            branchId: 'cemara',
            OR: [{ id: 'booking' }, { serviceForBookingId: 'booking' }],
          },
        }),
        data: { courtSlotId: 'new' },
      }),
    )
  }
  expect(mocks.inventory).toHaveBeenCalledWith(
    expect.objectContaining({ data: { slotId: 'new' } }),
  )
  expect(mocks.booking.mock.calls[0][0].data).toEqual({
    adminNote: expect.stringContaining('Existing note\n'),
  })
})
it('rejects a booking outside the selected branch without exposing or mutating it', async () => {
  mocks.detail.mockResolvedValue(null)
  await expect(execute()).rejects.toMatchObject({ status: 404 })
  expect(mocks.target).not.toHaveBeenCalled()
  expect(mocks.slots).not.toHaveBeenCalled()
})
it.each([
  ['cancelled', { status: 'CANCELLED' }],
  ['unconfirmed', { status: 'HOLD' }],
  ['unpaid', { invoice: { status: 'PENDING' } }],
  ['missing invoice', { invoice: null }],
  ['internal', { purpose: 'EVENT' }],
])('rejects %s bookings before claiming any target', async (_name, patch) => {
  const detail = source()
  mocks.detail.mockResolvedValue({
    ...detail,
    booking: { ...detail.booking, ...patch },
  })
  await expect(execute()).rejects.toMatchObject({ status: 400 })
  expect(mocks.slots).not.toHaveBeenCalled()
})
it('uses WIB when blocking a booking that has already started', async () => {
  await expect(
    changeAdminCourt(
      'admin',
      'cemara',
      'detail',
      input,
      new Date('2030-01-02T10:00:00+07:00'),
    ),
  ).rejects.toMatchObject({ status: 400 })
  expect(mocks.target).not.toHaveBeenCalled()
})
it('rejects repeated or stale requests after the original booking moved', async () => {
  mocks.detail.mockResolvedValue({ ...source(), slotId: 'already-moved' })
  await expect(execute()).rejects.toMatchObject({ status: 409 })
  expect(mocks.slots).not.toHaveBeenCalled()
})
it('rejects unavailable, closed, wrong-time, cross-sport or cross-branch targets excluded by the server query', async () => {
  mocks.target.mockReset().mockResolvedValue(null)
  await expect(execute()).rejects.toMatchObject({ status: 400 })
  expect(mocks.slots).not.toHaveBeenCalled()
})
it('rejects a price difference without touching the invoice or original slot', async () => {
  mocks.target
    .mockReset()
    .mockResolvedValue({ ...target(), discountPrice: 100000 })
  await expect(execute()).rejects.toMatchObject({ status: 400 })
  expect(mocks.slots).not.toHaveBeenCalled()
})
it('does not release or move the original slot when another checkout wins the target', async () => {
  mocks.slots.mockResolvedValue({ count: 0 })
  await expect(execute()).rejects.toMatchObject({ status: 409 })
  expect(mocks.slots).toHaveBeenCalledTimes(1)
  expect(mocks.move).not.toHaveBeenCalled()
  expect(mocks.coach).not.toHaveBeenCalled()
})
it('fails the transaction if the source was concurrently changed', async () => {
  mocks.move.mockResolvedValue({ count: 0 })
  await expect(execute()).rejects.toMatchObject({ status: 409 })
  expect(mocks.slots).toHaveBeenCalledTimes(1)
  expect(mocks.coach).not.toHaveBeenCalled()
})
it('returns a retryable conflict for serialization failures', async () => {
  mocks.transaction.mockRejectedValue({ code: 'P2034' })
  await expect(execute()).rejects.toMatchObject({ status: 409 })
})
it('preserves membership usage and the zero-paid detail', async () => {
  const detail = source()
  mocks.detail.mockResolvedValue({
    ...detail,
    discountPrice: 0,
    booking: { ...detail.booking, membershipUserId: 'pack' },
  })
  await execute()
  expect(mocks.move.mock.calls[0][0].data).toEqual({
    slotId: 'new',
    courtId: 'b',
  })
})
it('excludes booked legacy overlaps and different tariffs from the available choices', async () => {
  mocks.targets
    .mockResolvedValueOnce([
      { ...target(), id: 'free', courtId: 'free-court' },
      target(),
      { ...target(), id: 'expensive', discountPrice: 140000 },
    ])
    .mockResolvedValueOnce([{ courtId: 'b' }])
  expect(
    await getAdminCourtChangeOptions('admin', 'cemara', 'detail', now),
  ).toEqual([{ slotId: 'free', courtId: 'free-court', courtName: 'Court B' }])
})

it('lets an admin move a customer booking in the selected branch while locking the customer wallet', async () => {
  expect(
    await changeAdminCourt('admin', 'cemara', 'detail', input, now),
  ).toMatchObject({ slotId: 'new' })
  expect(mocks.detail.mock.calls[0][0].where).toEqual({
    id: 'detail',
    booking: { branchId: 'cemara' },
  })
  expect(mocks.detail.mock.calls[1][0].where.booking).toEqual({
    branchId: 'cemara',
  })
  expect(mocks.wallet).toHaveBeenCalledWith(expect.anything(), 'me')
  expect(mocks.booking.mock.calls[0][0].data.adminNote).toContain(
    'Admin admin pindah lapangan',
  )
})
it('rejects an admin request for a booking outside the selected branch before writing', async () => {
  mocks.detail.mockResolvedValue(null)
  await expect(
    changeAdminCourt('admin', 'other', 'detail', input, now),
  ).rejects.toMatchObject({ status: 404 })
  expect(mocks.transaction).not.toHaveBeenCalled()
})
it('offers admin court choices without requiring a customer login', async () => {
  mocks.targets.mockResolvedValueOnce([target()]).mockResolvedValueOnce([])
  expect(
    await getAdminCourtChangeOptions('admin', 'cemara', 'detail', now),
  ).toEqual([{ slotId: 'new', courtId: 'b', courtName: 'Court B' }])
  expect(mocks.detail.mock.calls[1][0].where).toEqual({
    id: 'detail',
    booking: { branchId: 'cemara' },
  })
})
