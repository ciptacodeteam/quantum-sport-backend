import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  save: vi.fn(),
  sell: vi.fn(),
  plans: vi.fn(),
  wallets: vi.fn(),
}))
vi.mock('@/services/inhouse-coaching.service', () => ({
  cancelUnusedInHouseWallet: mocks.remove,
  saveInHousePlan: mocks.save,
  sellInHousePlan: mocks.sell,
  listInHouseUsage: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    inHousePlan: { findMany: mocks.plans },
    inHouseWallet: { findMany: mocks.wallets },
  },
}))
import route from './inhouse-coaching.route'
const plan = {
  staffId: 'andi',
  name: 'Andi 5 jam',
  hours: 5,
  hourlyPrice: 900000,
  courtHourlyShare: 250000,
}
const sale = {
  packageId: 'plan',
  userId: 'customer',
  paymentMethodId: 'cash',
  requestId: '550e8400-e29b-41d4-a716-446655440000',
}
function request(
  path: string,
  role?: string,
  payload?: unknown,
  method = 'GET',
) {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  app.route('/admin', route)
  return app.request(
    `/admin/inhouse-coaching/${path}`,
    payload === undefined
      ? { method }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.save.mockResolvedValue({ id: 'plan' })
  mocks.sell.mockResolvedValue({ id: 'wallet' })
  mocks.plans.mockResolvedValue([])
  mocks.wallets.mockResolvedValue([])
})
it.each(['ADMIN', 'SUPER_ADMIN'])(
  'allows %s to configure coach-specific packages',
  async (role) => {
    expect((await request('plans', role, plan)).status).toBe(201)
    expect(mocks.save).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ ...plan, extraParticipantHourlyPrice: 100000 }),
    )
  },
)
it.each(['CASHIER', 'ADMIN_VIEWER', 'COACH', 'BALLBOY', undefined])(
  'blocks %s from changing package prices',
  async (role) => {
    expect((await request('plans', role, plan)).status).toBe(role ? 403 : 401)
    expect(mocks.save).not.toHaveBeenCalled()
  },
)
it.each(['ADMIN', 'SUPER_ADMIN', 'CASHIER'])(
  'allows %s to record paid package sales',
  async (role) => {
    expect((await request('sales', role, sale)).status).toBe(201)
    expect(mocks.sell).toHaveBeenCalledWith(sale, 'actor')
  },
)
it.each(['ADMIN_VIEWER', 'COACH', 'BALLBOY', undefined])(
  'blocks %s from selling packages',
  async (role) => {
    expect((await request('sales', role, sale)).status).toBe(role ? 403 : 401)
    expect(mocks.sell).not.toHaveBeenCalled()
  },
)
it('does not accept customer-provided prices or balances at sale', async () => {
  expect(
    (
      await request('sales', 'CASHIER', {
        ...sale,
        hourlyPrice: 1,
        remainingMinutes: 100000,
      })
    ).status,
  ).toBe(422)
  expect(mocks.sell).not.toHaveBeenCalled()
})

it.each(['ADMIN', 'SUPER_ADMIN', 'CASHIER'])(
  'allows %s to delete unused quota',
  async (role) => {
    mocks.remove.mockResolvedValue({ id: 'wallet' })
    expect(
      (await request('wallets/wallet', role, undefined, 'DELETE')).status,
    ).toBe(200)
    expect(mocks.remove).toHaveBeenCalledWith('wallet', 'actor')
  },
)
it.each(['ADMIN_VIEWER', 'COACH', 'BALLBOY', undefined])(
  'blocks %s from deleting quota',
  async (role) => {
    expect(
      (await request('wallets/wallet', role, undefined, 'DELETE')).status,
    ).toBe(role ? 403 : 401)
    expect(mocks.remove).not.toHaveBeenCalled()
  },
)

it('accepts a custom whole-hour package quota', async () => {
  expect(
    (
      await request('plans', 'ADMIN', {
        ...plan,
        name: 'Andi 12 jam',
        hours: 12,
      })
    ).status,
  ).toBe(201)
  expect(mocks.save).toHaveBeenCalledWith(
    undefined,
    expect.objectContaining({ hours: 12 }),
  )
})

it.each(['ADMIN', 'SUPER_ADMIN', 'CASHIER'])(
  'allows %s to cancel an unused package through the explicit action',
  async (role) => {
    mocks.remove.mockResolvedValue({ id: 'wallet' })
    expect(
      (await request('wallets/wallet/cancel', role, undefined, 'POST')).status,
    ).toBe(200)
    expect(mocks.remove).toHaveBeenCalledWith('wallet', 'actor')
  },
)
it('retains cancelled packages in history while excluding them from available booking quota', async () => {
  expect((await request('wallets', 'ADMIN')).status).toBe(200)
  expect(mocks.wallets.mock.calls[0][0].where).not.toHaveProperty('deletedAt')
  expect((await request('wallets?availableOnly=true', 'CASHIER')).status).toBe(
    200,
  )
  expect(mocks.wallets.mock.calls[1][0].where).toMatchObject({
    deletedAt: null,
    invoice: { status: 'PAID' },
  })
})
