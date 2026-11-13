import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  due: vi.fn(),
  detail: vi.fn(),
  debit: vi.fn(),
  membership: vi.fn(),
  booking: vi.fn(),
  lock: vi.fn(),
  settle: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    bookingDetail: { findMany: mocks.due },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: vi.fn(),
        bookingDetail: { findUnique: mocks.detail },
        membershipSessionDebit: { create: mocks.debit },
        membershipUser: { update: mocks.membership },
        booking: { update: mocks.booking },
      }),
  },
}))
vi.mock('./membership-renewal.service', () => ({
  lockCustomerWallet: mocks.lock,
  settleCustomerMembershipDebt: mocks.settle,
  withCustomerWallet: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/branch-context', () => ({
  withBranchContext: (_context: unknown, fn: () => unknown) => fn(),
}))
import { chargeDueRecurringMembershipSessions } from './recurring-membership-usage.service'

function detail(wall: string) {
  const startAt = new Date(`${wall}Z`)
  return {
    id: 'detail',
    bookingId: 'booking',
    membershipDebit: null,
    slot: { startAt, endAt: new Date(+startAt + 3_600_000) },
    booking: {
      branchId: 'cemara',
      userId: 'customer',
      membershipUserId: 'pack',
      status: 'CONFIRMED',
      recurringOccurrences: [{ series: { membershipUserId: 'pack' } }],
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.due.mockResolvedValue([
    {
      id: 'detail',
      bookingId: 'booking',
      booking: { branchId: 'cemara', userId: 'customer' },
    },
  ])
})

it.each(['2026-11-13T18:00:00', '2026-11-14T00:00:00'])(
  'debits at the WIB start %s, never before it, and only once on retries',
  async (wall) => {
    const source = detail(wall)
    mocks.detail.mockResolvedValue(source)
    const start = new Date(`${wall}+07:00`)
    // Even a stale candidate list must not cause an early debit.
    await chargeDueRecurringMembershipSessions(new Date(+start - 1))
    expect(mocks.debit).not.toHaveBeenCalled()
    expect(mocks.membership).not.toHaveBeenCalled()
    await chargeDueRecurringMembershipSessions(start)
    expect(mocks.due).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slot: { startAt: { lte: source.slot.startAt } },
        }),
      }),
    )
    expect(mocks.debit).toHaveBeenCalledExactlyOnceWith({
      data: {
        branchId: 'cemara',
        detailId: 'detail',
        membershipUserId: 'pack',
        sessions: 1,
        chargedAt: start,
      },
    })
    expect(mocks.membership).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'pack' },
      data: { remainingSessions: { decrement: 1 } },
    })
    mocks.detail.mockResolvedValue({
      ...source,
      membershipDebit: { id: 'charged' },
    })
    await chargeDueRecurringMembershipSessions(new Date(+start + 60_000))
    expect(mocks.debit).toHaveBeenCalledTimes(1)
    expect(mocks.membership).toHaveBeenCalledTimes(1)
  },
)

it('catches up a session after the scheduler was delayed, using the actual charge timestamp', async () => {
  mocks.detail.mockResolvedValue(detail('2026-11-13T18:00:00'))
  const now = new Date('2026-11-13T18:04:00+07:00')
  await chargeDueRecurringMembershipSessions(now)
  expect(mocks.debit).toHaveBeenCalledWith({
    data: expect.objectContaining({ chargedAt: now, sessions: 1 }),
  })
})
