import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
  lock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    $transaction: (fn: any) =>
      fn({
        bookingCoach: { findFirst: mocks.find, update: mocks.update },
        $queryRaw: mocks.lock,
      }),
  },
}))
import { setCoachClubSettlement } from './coach-club-settlement.service'
const now = new Date('2026-11-09T08:00:00Z')
const pack = (extra = {}) => ({
  id: 'coach-line',
  bookingId: 'booking',
  isClubSettled: false,
  status: 'CONFIRMED',
  booking: { status: 'CONFIRMED', invoice: { status: 'PAID' } },
  ...extra,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.find.mockResolvedValue(pack())
  mocks.update.mockResolvedValue({ isClubSettled: true })
})
it('records manual settlement and the staff actor under the booking lock', async () => {
  await setCoachClubSettlement(
    'coach-line',
    { isSettled: true, expectedIsSettled: false },
    'cashier',
    now,
  )
  expect(mocks.lock).toHaveBeenCalled()
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.update.mock.invocationCallOrder[0],
  )
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: 'coach-line' },
    data: {
      isClubSettled: true,
      clubSettlementUpdatedAt: now,
      clubSettlementUpdatedById: 'cashier',
    },
  })
})
it('can reopen a settled payable and retains audit of the reversal', async () => {
  mocks.find.mockResolvedValue(pack({ isClubSettled: true }))
  await setCoachClubSettlement(
    'coach-line',
    { isSettled: false, expectedIsSettled: true },
    'admin',
    now,
  )
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: {
        isClubSettled: false,
        clubSettlementUpdatedAt: now,
        clubSettlementUpdatedById: 'admin',
      },
    }),
  )
})
it('rejects stale requests rather than overwriting another staff decision', async () => {
  mocks.find.mockResolvedValue(pack({ isClubSettled: true }))
  await expect(
    setCoachClubSettlement(
      'coach-line',
      { isSettled: true, expectedIsSettled: false },
      'actor',
    ),
  ).rejects.toThrow('telah berubah')
  expect(mocks.update).not.toHaveBeenCalled()
})
it.each([
  { status: 'CANCELLED' },
  { booking: { status: 'CANCELLED', invoice: { status: 'PAID' } } },
  { booking: { status: 'CONFIRMED', invoice: { status: 'PENDING' } } },
  { booking: { status: 'CONFIRMED', invoice: null } },
])('rejects cancelled and unpaid services: %j', async (extra) => {
  mocks.find.mockResolvedValue(pack(extra))
  await expect(
    setCoachClubSettlement(
      'coach-line',
      { isSettled: true, expectedIsSettled: false },
      'actor',
    ),
  ).rejects.toThrow('terkonfirmasi')
  expect(mocks.update).not.toHaveBeenCalled()
})
it('rejects a booking absent from the selected branch', async () => {
  mocks.find.mockResolvedValue(null)
  await expect(
    setCoachClubSettlement(
      'other-branch',
      { isSettled: true, expectedIsSettled: false },
      'actor',
    ),
  ).rejects.toThrow('cabang ini')
  expect(mocks.update).not.toHaveBeenCalled()
})

it.each([
  { inHouseUsage: { id: 'usage' } },
  { inHouseUsage: null, bookingCoachType: { name: 'Coaching In-house' } },
])('does not settle in-house sessions as club payables: %j', async (source) => {
  mocks.find.mockResolvedValue(pack(source))
  await expect(
    setCoachClubSettlement(
      'coach-line',
      { isSettled: true, expectedIsSettled: false },
      'admin',
    ),
  ).rejects.toThrow(/in-house/)
  expect(mocks.update).not.toHaveBeenCalled()
})
