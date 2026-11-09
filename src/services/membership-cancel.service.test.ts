import { expect, it, vi } from 'vitest'
import {
  canCancelMembership,
  cancelUnusedMembership,
} from './membership-cancel.service'

const candidate = () => ({
  id: 'pack',
  userId: 'customer',
  remainingSessions: 10,
  debtSettledSessions: 0,
  membership: { sessions: 10 },
  invoice: { id: 'invoice', status: 'PAID', payment: { id: 'payment' } },
  _count: {
    usedBookings: 0,
    sessionDebits: 0,
    recurringBookings: 0,
    debtsReceived: 0,
    debtsTransferred: 0,
  },
})
it('allows unused paid and pending purchases only', () => {
  expect(canCancelMembership(candidate())).toBe(true)
  expect(
    canCancelMembership({ ...candidate(), invoice: { status: 'PENDING' } }),
  ).toBe(true)
  for (const status of ['CANCELLED', 'REFUNDED', 'FAILED', 'EXPIRED'])
    expect(canCancelMembership({ ...candidate(), invoice: { status } })).toBe(
      false,
    )
  expect(canCancelMembership({ ...candidate(), invoice: null })).toBe(false)
})
it('blocks quota use, debt settlement, and booking history even if the balance was restored', () => {
  expect(canCancelMembership({ ...candidate(), remainingSessions: 9 })).toBe(
    false,
  )
  expect(canCancelMembership({ ...candidate(), debtSettledSessions: 1 })).toBe(
    false,
  )
  for (const field of Object.keys(candidate()._count)) {
    const pack = candidate()
    pack._count[field as keyof typeof pack._count] = 1
    expect(canCancelMembership(pack)).toBe(false)
  }
})
it('locks the wallet and quota, cancels payment and invoice, and disables the pack', async () => {
  const tx = {
    $queryRaw: vi.fn(),
    membershipUser: {
      findUnique: vi.fn().mockResolvedValue(candidate()),
      update: vi.fn(),
    },
    invoice: { update: vi.fn() },
    payment: { update: vi.fn() },
  }
  await cancelUnusedMembership(tx as any, 'pack')
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
  expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
    tx.invoice.update.mock.invocationCallOrder[0],
  )
  expect(tx.invoice.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    }),
  )
  expect(tx.payment.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'payment' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    }),
  )
  expect(tx.membershipUser.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ isExpired: true, isSuspended: true }),
    }),
  )
})
it('rejects used purchases without changing any records', async () => {
  const tx = {
    $queryRaw: vi.fn(),
    membershipUser: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ ...candidate(), remainingSessions: 9 }),
      update: vi.fn(),
    },
    invoice: { update: vi.fn() },
    payment: { update: vi.fn() },
  }
  await expect(cancelUnusedMembership(tx as any, 'pack')).rejects.toThrow(
    'belum dipakai',
  )
  expect(tx.invoice.update).not.toHaveBeenCalled()
  expect(tx.payment.update).not.toHaveBeenCalled()
  expect(tx.membershipUser.update).not.toHaveBeenCalled()
})
