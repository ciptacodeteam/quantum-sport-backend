import { branchContext, withBranchContext } from '@/lib/branch-context'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  people: vi.fn(),
  existing: vi.fn(),
  court: vi.fn(),
  fresh: vi.fn(),
  overlaps: vi.fn(),
  create: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    staff: { findMany: mocks.people },
    slot: { findMany: mocks.existing, findFirst: mocks.court },
    $transaction: mocks.transaction,
  },
}))
import { ensureServiceScheduleRange } from './service-schedule-range.service'
const startAt = new Date('2030-01-02T10:00:00Z'),
  endAt = new Date('2030-01-02T11:00:00Z')
const now = new Date('2030-01-01T00:00:00+07:00')
const person = (id: string, role = 'COACH') => ({
  id,
  role,
  rollingServiceSchedule: {
    followCourtWindow: true,
    days: [1, 2, 3, 4, 5, 6, 7],
    startHour: 6,
    endHour: 24,
    price: 150000,
    additionalHourPrice: 100000,
  },
})
const run = () =>
  ensureServiceScheduleRange('cemara', 'PADEL', startAt, endAt, now)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.people.mockResolvedValue([
    person('coach'),
    person('ballboy', 'BALLBOY'),
  ])
  mocks.existing.mockResolvedValue([])
  mocks.court.mockResolvedValue({ id: 'court' })
  mocks.fresh.mockResolvedValue([person('coach'), person('ballboy', 'BALLBOY')])
  mocks.overlaps.mockResolvedValue([])
  mocks.transaction.mockImplementation((fn) =>
    fn({
      $queryRaw: mocks.lock,
      staff: { findMany: mocks.fresh },
      slot: { findMany: mocks.overlaps, createMany: mocks.create },
    }),
  )
})
it('fills only the requested hour in one batch and scopes profiles to branch and sport', async () => {
  await run()
  expect(mocks.people.mock.calls[0][0].where).toMatchObject({
    branchId: 'cemara',
    isActive: true,
    OR: [
      { role: 'COACH', coachType: { in: ['PADEL', 'PADEL_TENNIS'] } },
      {
        role: 'BALLBOY',
        OR: [{ coachType: { in: ['PADEL', 'PADEL_TENNIS'] } }],
      },
    ],
  })
  expect(mocks.existing.mock.calls[0][0].where).toMatchObject({
    branchId: 'cemara',
    startAt: { lt: endAt },
    endAt: { gt: startAt },
  })
  expect(mocks.transaction).toHaveBeenCalledTimes(1)
  expect(mocks.lock).toHaveBeenCalledTimes(1)
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(mocks.create.mock.calls[0][0].data).toEqual([
    {
      staffId: 'coach',
      branchId: 'cemara',
      type: 'COACH',
      startAt,
      endAt,
      price: 150000,
      additionalHourPrice: 100000,
      isAvailable: true,
    },
    {
      staffId: 'ballboy',
      branchId: 'cemara',
      type: 'BALLBOY',
      startAt,
      endAt,
      price: 150000,
      additionalHourPrice: null,
      isAvailable: true,
    },
  ])
})
it('does no maintenance when existing slots include manually closed or booked rows', async () => {
  mocks.existing.mockResolvedValue([
    { staffId: 'coach' },
    { staffId: 'ballboy' },
  ])
  await run()
  expect(mocks.transaction).not.toHaveBeenCalled()
  expect(mocks.court).toHaveBeenCalledTimes(1)
  expect(mocks.create).not.toHaveBeenCalled()
})
it('does not generate schedules without a matching open court in its booking window', async () => {
  mocks.court.mockResolvedValue(null)
  await run()
  expect(mocks.transaction).not.toHaveBeenCalled()
  expect(mocks.court.mock.calls[0][0].where).toMatchObject({
    branchId: 'cemara',
    type: 'COURT',
    startAt,
    endAt,
    scheduleClosed: false,
    court: {
      isActive: true,
      sport: 'PADEL',
      bookingWindowMonths: { not: null },
    },
  })
})
it('preserves rows created or manually closed by a concurrent request while waiting for locks', async () => {
  mocks.overlaps.mockResolvedValue([
    { staffId: 'coach' },
    { staffId: 'ballboy' },
  ])
  await run()
  expect(mocks.create).not.toHaveBeenCalled()
})
it('rechecks updated profiles after locking instead of using stale eligibility or prices', async () => {
  mocks.fresh.mockResolvedValue([
    {
      ...person('coach'),
      rollingServiceSchedule: {
        ...person('coach').rollingServiceSchedule,
        price: 200000,
      },
    },
  ])
  await run()
  expect(mocks.create.mock.calls[0][0].data).toHaveLength(1)
  expect(mocks.create.mock.calls[0][0].data[0]).toMatchObject({
    staffId: 'coach',
    price: 200000,
  })
})
it('does not create hours excluded by the rolling service settings', async () => {
  mocks.people.mockResolvedValue([
    {
      ...person('coach'),
      rollingServiceSchedule: {
        ...person('coach').rollingServiceSchedule,
        startHour: 12,
      },
    },
  ])
  await run()
  expect(mocks.existing).not.toHaveBeenCalled()
  expect(mocks.create).not.toHaveBeenCalled()
})

it('uses the booking branch for lazy generation when a super admin browses all branches', async () => {
  mocks.transaction.mockImplementation(async () => {
    expect(branchContext.getStore()?.branchId).toBe('cemara')
  })
  await withBranchContext(
    { branchId: null, isAdmin: true, isSuperAdmin: true },
    run,
  )
  expect(mocks.transaction).toHaveBeenCalledTimes(1)
})

it('excludes existing rolling slots after the corresponding court hour has been closed', async () => {
  mocks.existing.mockResolvedValue([
    { staffId: 'coach' },
    { staffId: 'ballboy' },
  ])
  mocks.court.mockResolvedValue(null)
  expect(await run()).toEqual(['coach', 'ballboy'])
  expect(mocks.transaction).not.toHaveBeenCalled()
})
