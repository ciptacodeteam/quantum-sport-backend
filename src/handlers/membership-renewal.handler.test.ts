import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    membership: { findUnique: mocks.findUnique },
    membershipUser: { findMany: mocks.findMany },
  },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
import { membershipRenewalPreviewHandler } from './membership-renewal.handler'
const pack = (id: string, balance: number, date: string) => ({
  id,
  userId: 'customer',
  createdAt: new Date(date),
  startDate: new Date(date),
  endDate: new Date('2099-01-01'),
  remainingSessions: balance,
  debtSettledSessions: 0,
  isExpired: false,
  isSuspended: false,
  membership: { sport: 'PADEL' },
  invoice: { status: 'PAID' },
  debtsReceived: [],
})
const preview = async () =>
  await (membershipRenewalPreviewHandler.at(-1) as any)({
    req: { valid: () => ({ id: 'product' }) },
    get: () => ({ id: 'customer' }),
    json: (body: unknown) => body,
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.findUnique.mockResolvedValue({ sport: 'PADEL', sessions: 10 })
  mocks.findMany.mockResolvedValue([pack('old', -2, '2025-01-01')])
})
it('quotes only the signed-in customer and same sport, without changing balances', async () => {
  const result = await preview()
  expect(mocks.findMany.mock.calls[0][0].where).toEqual({
    userId: 'customer',
    membership: { sport: 'PADEL' },
    invoice: { status: 'PAID' },
  })
  expect(result.data).toMatchObject({
    packageSessions: 10,
    debtSessions: 2,
    debtSettledSessions: 2,
    remainingAfterPurchase: 8,
    unsettledDebtSessions: 0,
    reviewRequired: false,
  })
})
it('caps the new package at zero and quotes the debt left on old packages', async () => {
  mocks.findUnique.mockResolvedValue({ sport: 'PADEL', sessions: 1 })
  expect((await preview()).data).toMatchObject({
    remainingAfterPurchase: 0,
    debtSettledSessions: 1,
    unsettledDebtSessions: 1,
  })
})
it('accounts for quota on an existing paid newer package before quoting a further purchase', async () => {
  mocks.findMany.mockResolvedValue([
    pack('old', -4, '2025-01-01'),
    pack('new', 26, '2026-01-01'),
  ])
  expect((await preview()).data).toMatchObject({
    debtSessions: 0,
    debtSettledSessions: 0,
    remainingAfterPurchase: 10,
    unsettledDebtSessions: 0,
  })
})
it('reports ambiguous history for review instead of quoting another deduction', async () => {
  mocks.findMany.mockResolvedValue([
    pack('old', -4, '2025-01-01'),
    { ...pack('new', 26, '2026-01-01'), debtSettledSessions: 4 },
  ])
  expect((await preview()).data).toMatchObject({
    reviewRequired: true,
    debtSettledSessions: 0,
    remainingAfterPurchase: 10,
    unsettledDebtSessions: 4,
  })
})
