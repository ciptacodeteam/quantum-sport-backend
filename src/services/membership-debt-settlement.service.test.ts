import { beforeEach, expect, it, vi } from 'vitest'
import {
  settleCustomerMembershipDebt,
  applyPaidMembershipRenewal,
  creditMembershipIncludingTransferredDebt,
} from './membership-renewal.service'
const now = new Date('2026-11-06T05:00:00Z')
let packs: any[], transfers: any[], tx: any
const make = (id: string, balance: number, date: string) => ({
  id,
  userId: 'customer',
  createdAt: new Date(date),
  startDate: new Date(date),
  endDate: new Date('2027-11-01'),
  remainingSessions: balance,
  debtSettledSessions: 0,
  renewalAppliedAt: new Date('2026-09-21'),
  isExpired: false,
  isSuspended: false,
  membership: { sport: 'TENNIS' },
  invoice: { status: 'PAID' },
})
beforeEach(() => {
  packs = [make('old', -4, '2025-12-03'), make('new', 26, '2026-09-21')]
  transfers = []
  tx = {
    $queryRaw: vi.fn(),
    membershipUser: {
      findMany: vi
        .fn()
        .mockImplementation(async () =>
          packs.map((pack) => ({
            ...pack,
            debtsReceived: transfers
              .filter((row) => row.toMembershipUserId === pack.id)
              .map((row) => ({ ...row })),
          })),
        ),
      findUnique: vi
        .fn()
        .mockImplementation(async ({ where }: any) => ({
          ...packs.find((pack) => pack.id === where.id),
        })),
      findUniqueOrThrow: vi
        .fn()
        .mockImplementation(async ({ where }: any) => ({
          ...packs.find((pack) => pack.id === where.id),
        })),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const pack = packs.find((pack) => pack.id === where.id)
        if (
          where.remainingSessions?.gte !== undefined &&
          pack.remainingSessions < where.remainingSessions.gte
        )
          throw Error('stale balance')
        if (
          where.remainingSessions?.lte !== undefined &&
          pack.remainingSessions > where.remainingSessions.lte
        )
          throw Error('stale debt')
        for (const [key, value] of Object.entries(data) as any)
          pack[key] =
            typeof value === 'object' && value !== null && 'increment' in value
              ? pack[key] + value.increment
              : typeof value === 'object' &&
                  value !== null &&
                  'decrement' in value
                ? pack[key] - value.decrement
                : value
        return { ...pack }
      }),
      updateMany: vi.fn(),
    },
    membershipDebtTransfer: {
      upsert: vi.fn().mockImplementation(async ({ create, update }: any) => {
        const existing = transfers.find(
          (row) =>
            row.fromMembershipUserId === create.fromMembershipUserId &&
            row.toMembershipUserId === create.toMembershipUserId,
        )
        if (existing) {
          existing.sessions += update.sessions.increment
          return existing
        }
        const row = {
          id: `transfer-${transfers.length}`,
          restoredSessions: 0,
          ...create,
        }
        transfers.push(row)
        return row
      }),
      findMany: vi
        .fn()
        .mockImplementation(async ({ where }: any) =>
          transfers.filter(
            (row) => row.fromMembershipUserId === where.fromMembershipUserId,
          ),
        ),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = transfers.find((row) => row.id === where.id)
        row.restoredSessions += data.restoredSessions.increment
        return row
      }),
    },
    recurringBooking: { updateMany: vi.fn() },
  }
})
it('repairs a missed old debt even when the paid renewal was already processed, without resetting dates', async () => {
  const before = { ...packs[1] }
  await applyPaidMembershipRenewal(tx, 'new', now)
  expect(packs.map((pack) => pack.remainingSessions)).toEqual([0, 22])
  expect(packs[1].debtSettledSessions).toBe(4)
  expect(packs[1].startDate).toEqual(before.startDate)
  expect(packs[1].endDate).toEqual(before.endDate)
  expect(packs[1].renewalAppliedAt).toEqual(before.renewalAppliedAt)
  expect(transfers).toHaveLength(1)
  expect(tx.recurringBooking.updateMany).toHaveBeenCalledWith({
    where: { userId: 'customer', membershipUserId: 'old' },
    data: { membershipUserId: 'new' },
  })
  await applyPaidMembershipRenewal(tx, 'new', now)
  expect(packs.map((pack) => pack.remainingSessions)).toEqual([0, 22])
  expect(transfers).toHaveLength(1)
})
it('caps partial settlement, handles a later refill, and refunds to the actual funding packages', async () => {
  packs[0].remainingSessions = -12
  packs[1].remainingSessions = 10
  await settleCustomerMembershipDebt(tx, 'customer', now)
  expect(packs.map((pack) => pack.remainingSessions)).toEqual([-2, 0])
  packs.push(make('refill', 10, '2026-10-01'))
  await settleCustomerMembershipDebt(tx, 'customer', now)
  expect(packs.map((pack) => pack.remainingSessions)).toEqual([0, 0, 8])
  await creditMembershipIncludingTransferredDebt(tx, 'old', 13, now)
  expect(packs.map((pack) => pack.remainingSessions)).toEqual([1, 10, 10])
})
it('accumulates fresh later debt on the same transfer without resetting recorded refunds', async () => {
  await settleCustomerMembershipDebt(tx, 'customer', now)
  packs[0].remainingSessions = -2
  transfers[0].restoredSessions = 1
  await settleCustomerMembershipDebt(tx, 'customer', now)
  expect(packs[1].remainingSessions).toBe(20)
  expect(packs[1].debtSettledSessions).toBe(6)
  expect(transfers[0]).toMatchObject({ sessions: 6, restoredSessions: 1 })
})
it('uses conditional quota updates so concurrent booking usage cannot overdraw the new package', async () => {
  const update = tx.membershipUser.update.getMockImplementation()
  tx.membershipUser.update.mockImplementationOnce(async (args: any) => {
    packs[1].remainingSessions = 1
    return update(args)
  })
  await expect(
    settleCustomerMembershipDebt(tx, 'customer', now),
  ).rejects.toThrow('stale balance')
  expect(transfers).toHaveLength(0)
  expect(packs[0].remainingSessions).toBe(-4)
})
