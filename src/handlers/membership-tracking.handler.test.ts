import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { membershipUser: { findMany: mocks.findMany } },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
import { getMyMembershipTrackingHandler } from './membership-tracking.handler'
import { getTrackedPackageStatus } from '@/services/membership-tracking.service'
const now = new Date('2026-10-23T00:00:00Z')
const state = {
  startDate: new Date('2026-10-01T00:00:00Z'),
  endDate: new Date('2030-01-01T00:00:00Z'),
  remainingSessions: 6,
  isExpired: false,
  isSuspended: false,
}
beforeEach(() => mocks.findMany.mockReset())
async function read(user: { id: string } | null) {
  return (getMyMembershipTrackingHandler[0] as any)({
    get: () => user,
    json: (body: unknown, http: number) => ({ body, http }),
  })
}
it('requires a customer session before reading package data', async () => {
  const response = await read(null)
  expect(response.http).toBe(401)
  expect(mocks.findMany).not.toHaveBeenCalled()
})
it('scopes packages to the signed-in customer and separates confirmed usage from holds and cancellations', async () => {
  mocks.findMany.mockResolvedValue([
    {
      ...state,
      id: 'pack-user',
      membership: {
        name: 'Silver Member',
        sport: 'PADEL',
        type: 'ALL_HOUR',
        sessions: 10,
      },
      invoice: { number: 'PACK-INVOICE', status: 'PAID' },
      usedBookings: [
        {
          id: 'used',
          status: 'CONFIRMED',
          membershipSessionsUsed: 3,
          createdAt: now,
          invoice: { number: 'BOOKING-1' },
          details: [],
        },
        {
          id: 'held',
          status: 'HOLD',
          membershipSessionsUsed: 1,
          createdAt: now,
          invoice: { number: 'BOOKING-2' },
          details: [],
        },
        {
          id: 'cancelled',
          status: 'CANCELLED',
          membershipSessionsUsed: 4,
          createdAt: now,
          invoice: null,
          details: [],
        },
      ],
    },
  ])
  const response = await read({ id: 'customer-1' })
  expect(mocks.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'customer-1' } }),
  )
  expect(response.body.data.packages[0]).toMatchObject({
    remainingHours: 6,
    usedHours: 3,
    heldHours: 1,
    totalHours: 10,
    status: 'ACTIVE',
  })
  expect(response.body.data.packages[0].usage).toHaveLength(3)
  expect(response.body.data.packages[0]).not.toHaveProperty('userId')
})
it('does not report unpaid memberships as active', () => {
  expect(
    getTrackedPackageStatus({ ...state, invoice: { status: 'PENDING' } }, now),
  ).toBe('PENDING')
  expect(
    getTrackedPackageStatus(
      { ...state, invoice: { status: 'CANCELLED' } },
      now,
    ),
  ).toBe('PAYMENT_FAILED')
})
it('distinguishes depleted hours, expiration, suspension and upcoming packages', () => {
  expect(
    getTrackedPackageStatus(
      { ...state, remainingSessions: 0, isExpired: true },
      now,
    ),
  ).toBe('EXHAUSTED')
  expect(
    getTrackedPackageStatus({ ...state, endDate: new Date('2026-10-01') }, now),
  ).toBe('EXPIRED')
  expect(getTrackedPackageStatus({ ...state, isSuspended: true }, now)).toBe(
    'SUSPENDED',
  )
  expect(
    getTrackedPackageStatus(
      { ...state, startDate: new Date('2027-01-01') },
      now,
    ),
  ).toBe('UPCOMING')
})
