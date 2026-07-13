import { describe, expect, it, vi } from 'vitest'
import { restoreMembershipSessionsForCancelledBooking } from './membership-booking.service'

function createTx(
  membershipUser: {
    id: string
    remainingSessions: number
    endDate: Date
    membership: { sessions: number }
  } | null,
) {
  return {
    membershipUser: {
      findUnique: vi.fn().mockResolvedValue(membershipUser),
      update: vi.fn().mockResolvedValue(membershipUser),
    },
  }
}

describe('restoreMembershipSessionsForCancelledBooking', () => {
  it('restores a 2 hour admin-cancelled booking from 48 back to 50 sessions', async () => {
    const futureEndDate = new Date(Date.now() + 86_400_000)
    const tx = createTx({
      id: 'membership-user-50-sessions',
      remainingSessions: 48,
      endDate: futureEndDate,
      membership: { sessions: 50 },
    })

    const restored = await restoreMembershipSessionsForCancelledBooking(tx, {
      membershipUserId: 'membership-user-50-sessions',
      membershipSessionsUsed: 2,
    })

    expect(restored).toBe(2)
    expect(tx.membershipUser.update).toHaveBeenCalledWith({
      where: { id: 'membership-user-50-sessions' },
      data: {
        remainingSessions: 50,
        isExpired: false,
      },
    })
  })

  it('restores used booking sessions without exceeding package sessions', async () => {
    const futureEndDate = new Date(Date.now() + 86_400_000)
    const tx = createTx({
      id: 'membership-user-1',
      remainingSessions: 8,
      endDate: futureEndDate,
      membership: { sessions: 10 },
    })

    const restored = await restoreMembershipSessionsForCancelledBooking(tx, {
      membershipUserId: 'membership-user-1',
      membershipSessionsUsed: 3,
    })

    expect(restored).toBe(2)
    expect(tx.membershipUser.update).toHaveBeenCalledWith({
      where: { id: 'membership-user-1' },
      data: {
        remainingSessions: 10,
        isExpired: false,
      },
    })
  })

  it('reactivates a future-dated membership when restored sessions are available', async () => {
    const futureEndDate = new Date(Date.now() + 86_400_000)
    const tx = createTx({
      id: 'membership-user-2',
      remainingSessions: 0,
      endDate: futureEndDate,
      membership: { sessions: 10 },
    })

    const restored = await restoreMembershipSessionsForCancelledBooking(tx, {
      membershipUserId: 'membership-user-2',
      membershipSessionsUsed: 1,
    })

    expect(restored).toBe(1)
    expect(tx.membershipUser.update).toHaveBeenCalledWith({
      where: { id: 'membership-user-2' },
      data: {
        remainingSessions: 1,
        isExpired: false,
      },
    })
  })

  it('does nothing when booking did not use membership sessions', async () => {
    const tx = createTx({
      id: 'membership-user-3',
      remainingSessions: 5,
      endDate: new Date(Date.now() + 86_400_000),
      membership: { sessions: 10 },
    })

    const restored = await restoreMembershipSessionsForCancelledBooking(tx, {
      membershipUserId: 'membership-user-3',
      membershipSessionsUsed: 0,
    })

    expect(restored).toBe(0)
    expect(tx.membershipUser.findUnique).not.toHaveBeenCalled()
    expect(tx.membershipUser.update).not.toHaveBeenCalled()
  })
})
