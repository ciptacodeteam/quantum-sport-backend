import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), active: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { membershipUser: { findMany: mocks.list, findFirst: mocks.active } },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
import {
  getUserMembershipsHandler,
  getMyActiveMembershipHandler,
} from './membership.handler'
const context = () => ({
  get: () => ({ id: 'customer' }),
  json: (body: any) => body,
  var: { logger: { fatal: vi.fn() } },
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([])
  mocks.active.mockResolvedValue(null)
})
it('counts only paid purchases in the customer profile membership summary', async () => {
  const response = await (getUserMembershipsHandler[0] as any)(context())
  expect(mocks.list).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'customer', invoice: { status: 'PAID' } },
    }),
  )
  expect(response.data).toEqual({
    active: [],
    expired: [],
    suspended: [],
    total: 0,
  })
})
it('requires a paid invoice before granting active membership booking privileges', async () => {
  const response = await (getMyActiveMembershipHandler[0] as any)(context())
  expect(mocks.active).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        userId: 'customer',
        invoice: { status: 'PAID' },
      }),
    }),
  )
  expect(response.data.activeMembership).toBeNull()
})

it('returns the original purchase terms in active and owned package APIs after catalogue edits', async () => {
  const pack = {
    id: 'old-pack',
    startDate: new Date('2020-01-01'),
    endDate: new Date('2040-01-01'),
    remainingSessions: 32,
    remainingDuration: 60,
    isExpired: false,
    isSuspended: false,
    purchasedPrice: 10000000,
    purchasedSessions: 50,
    purchasedDuration: 91,
    purchasedType: 'ALL_HOUR',
    membership: {
      id: 'product',
      name: 'Club',
      isPublic: false,
      price: 12500000,
      sessions: 100,
      duration: 30,
      type: 'HAPPY_HOUR',
      sport: 'PADEL',
    },
  }
  mocks.active.mockResolvedValue(pack)
  mocks.list.mockResolvedValue([pack])
  const active = await (getMyActiveMembershipHandler[0] as any)(context())
  expect(active.data.activeMembership.membership).toMatchObject({
    price: 10000000,
    sessions: 50,
    type: 'ALL_HOUR',
  })
  const owned = await (getUserMembershipsHandler[0] as any)(context())
  expect(owned.data.active[0].membership).toMatchObject({
    price: 10000000,
    sessions: 50,
    duration: 91,
    type: 'ALL_HOUR',
  })
})
