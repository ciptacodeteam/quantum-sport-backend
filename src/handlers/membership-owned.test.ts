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
