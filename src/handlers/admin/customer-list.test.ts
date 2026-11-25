import { expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createFactory } from 'hono/factory'
import type { AppEnv } from '@/types'
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  membership: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: { findMany: mocks.findMany, findUnique: mocks.findUnique },
    membershipUser: { findFirst: mocks.membership },
  },
}))
vi.mock('@/lib/create-app', () => ({ factory: createFactory<AppEnv>() }))
vi.mock('@/services/password-reset.service', () => ({
  buildPasswordResetLink: vi.fn(),
  createPasswordResetToken: vi.fn(),
}))
vi.mock('@/services/upload.service', () => ({
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
}))
import {
  getAllUsersHandler,
  getCustomerMembershipDetailsHandler,
} from './user.handler'

it('returns stored Management categories and validity dates for the customer table', async () => {
  const records = [
    {
      id: 'management',
      name: 'Management BPC',
      isManagement: true,
      managementValidFrom: new Date('2026-11-01T00:00:00Z'),
      managementValidUntil: new Date('2026-12-31T00:00:00Z'),
    },
    {
      id: 'regular',
      name: 'Pelanggan Reguler',
      isManagement: false,
      managementValidFrom: null,
      managementValidUntil: null,
    },
  ]
  // Emulate Prisma selection so missing fields cannot be hidden by a full-row mock.
  mocks.findMany.mockImplementation(async ({ select }) =>
    records.map((record) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => select[key])),
    ),
  )
  const app = new Hono<AppEnv>()
  app.get('/customers', ...getAllUsersHandler)
  const response = await app.request('/customers')
  expect(response.status).toBe(200)
  const body = (await response.json()) as { data: unknown }
  expect(body.data).toEqual([
    {
      id: 'management',
      name: 'Management BPC',
      isManagement: true,
      managementValidFrom: '2026-11-01T00:00:00.000Z',
      managementValidUntil: '2026-12-31T00:00:00.000Z',
    },
    {
      id: 'regular',
      name: 'Pelanggan Reguler',
      isManagement: false,
      managementValidFrom: null,
      managementValidUntil: null,
    },
  ])
})

it.each(['PADEL', 'TENNIS'])(
  'returns only the selected %s membership when a customer owns both sports',
  async (sport) => {
    mocks.findUnique.mockResolvedValue({ id: 'customer', name: 'Pelanggan' })
    const packs = ['PADEL', 'TENNIS'].map((category) => ({
      id: `wallet-${category}`,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2099-01-01'),
      remainingSessions: 78,
      remainingDuration: 30,
      purchasedPrice: 1000000,
      purchasedType: 'ALL_HOUR',
      isExpired: false,
      isSuspended: false,
      membership: {
        id: `pack-${category}`,
        name: `Paket ${category}`,
        price: 1000000,
        sport: category,
        type: 'ALL_HOUR',
      },
    }))
    mocks.membership.mockImplementation(
      async ({ where }) =>
        packs.find(
          (pack) =>
            !where.membership?.sport ||
            pack.membership.sport === where.membership.sport,
        ) ?? null,
    )
    const app = new Hono<AppEnv>()
    app.get('/customers/:id/membership', ...getCustomerMembershipDetailsHandler)
    const response = await app.request(
      `/customers/customer/membership?sport=${sport}`,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        activeMembership: { id: `wallet-${sport}`, membership: { sport } },
      },
    })
  },
)
it('does not return a padel package for a tennis-only membership request', async () => {
  mocks.findUnique.mockResolvedValue({ id: 'customer', name: 'Pelanggan' })
  mocks.membership.mockImplementation(async ({ where }) =>
    where.membership?.sport === 'TENNIS'
      ? null
      : { id: 'padel', membership: { sport: 'PADEL' } },
  )
  const app = new Hono<AppEnv>()
  app.get('/customers/:id/membership', ...getCustomerMembershipDetailsHandler)
  const response = await app.request(
    '/customers/customer/membership?sport=TENNIS',
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    data: { activeMembership: null },
  })
})
