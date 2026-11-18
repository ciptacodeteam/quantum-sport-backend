import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ wallets: vi.fn(), branches: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    inHouseWallet: { findMany: mocks.wallets },
    branch: { findMany: mocks.branches },
  },
}))
import { getMyCoachingTrackingHandler } from './coaching-tracking.handler'
const usage = (id: string, restoredAt: Date | null = null) => ({
  id,
  minutes: 60,
  participants: 2,
  createdAt: new Date('2026-11-17T02:00:00Z'),
  restoredAt,
  bookingCoach: {
    status: restoredAt ? 'CANCELLED' : 'CONFIRMED',
    slot: {
      startAt: new Date('2026-11-18T15:00:00Z'),
      endAt: new Date('2026-11-18T16:00:00Z'),
    },
    courtSlot: { court: { name: 'Court 1' } },
    booking: {
      status: restoredAt ? 'CANCELLED' : 'CONFIRMED',
      branch: { name: 'Cemara' },
      invoice: { number: `INV-${id}` },
    },
  },
})
const wallet = () => ({
  id: 'wallet',
  branchId: 'cemara',
  packageName: 'Coaching 5 Jam',
  totalMinutes: 300,
  remainingMinutes: 240,
  createdAt: new Date('2026-11-16T02:00:00Z'),
  staff: { name: 'Coach Andi', coachType: 'PADEL', isActive: true },
  invoice: { number: 'INV-PACK', status: 'PAID' },
  usages: [usage('used'), usage('returned', new Date('2026-11-18T02:00:00Z'))],
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.wallets.mockResolvedValue([wallet()])
  mocks.branches.mockResolvedValue([{ id: 'cemara', name: 'Cemara' }])
})
function read(userId: string | null = 'customer') {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    if (userId) c.set('user', { id: userId })
    await next()
  })
  app.get('/tracking', ...getMyCoachingTrackingHandler)
  return app.request('/tracking?userId=another-customer&branchId=other')
}
it('requires a signed-in customer before reading coaching data', async () => {
  expect((await read(null)).status).toBe(401)
  expect(mocks.wallets).not.toHaveBeenCalled()
})
it('scopes paid uncancelled packages to the session and excludes restored sessions from used hours', async () => {
  const res = await read()
  expect(mocks.wallets.mock.lastCall?.[0].where).toEqual({
    userId: 'customer',
    deletedAt: null,
    invoice: { status: 'PAID' },
  })
  const body = (await res.json()) as any
  expect(body.data.packages[0]).toMatchObject({
    name: 'Coaching 5 Jam',
    coachName: 'Coach Andi',
    branchName: 'Cemara',
    totalHours: 5,
    remainingHours: 4,
    usedHours: 1,
    status: 'ACTIVE',
  })
  expect(body.data.packages[0].usage).toEqual([
    expect.objectContaining({
      status: 'CONFIRMED',
      hours: 1,
      participants: 2,
      invoiceNumber: 'INV-used',
      courtName: 'Court 1',
      startAt: '2026-11-18T15:00:00.000Z',
    }),
    expect.objectContaining({
      status: 'RESTORED',
      hours: 1,
      restoredAt: '2026-11-18T02:00:00.000Z',
    }),
  ])
  expect(body.data.packages[0]).not.toHaveProperty('hourlyPrice')
  expect(body.data.packages[0]).not.toHaveProperty('userId')
})
it.each([
  [0, true, 'EXHAUSTED'],
  [240, false, 'SUSPENDED'],
])(
  'handles depleted and unavailable packages',
  async (remainingMinutes, active, status) => {
    const pack = wallet()
    pack.remainingMinutes = remainingMinutes as number
    pack.staff.isActive = active as boolean
    pack.usages[0].bookingCoach.courtSlot = null as any
    pack.usages[0].bookingCoach.booking.invoice = null as any
    mocks.wallets.mockResolvedValue([pack])
    expect(
      ((await (await read()).json()) as any).data.packages[0],
    ).toMatchObject({
      status,
      usage: [
        expect.objectContaining({ courtName: null, invoiceNumber: null }),
        expect.anything(),
      ],
    })
  },
)
it('returns an empty list without treating a missing package as an error', async () => {
  mocks.wallets.mockResolvedValue([])
  expect(((await (await read()).json()) as any).data.packages).toEqual([])
  expect(mocks.branches).not.toHaveBeenCalled()
})
