import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  slots: vi.fn(),
  ballboy: vi.fn(),
  previous: vi.fn(),
  global: vi.fn(),
  range: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    bookingDetail: { findFirst: mocks.detail },
    slot: { findMany: mocks.slots },
    bookingBallboy: { findFirst: mocks.ballboy },
    bookingCoach: { findMany: mocks.previous },
  },
}))
vi.mock('./rolling-court-schedule.service', () => ({
  ensureRollingCourtSchedules: mocks.global,
}))
vi.mock('./service-schedule-range.service', () => ({
  ensureServiceScheduleRange: mocks.range,
}))
vi.mock('./midtrans.service', () => ({
  midtransService: {},
  isSupportedChannel: vi.fn(),
  isPaidStatus: vi.fn(),
}))
vi.mock('./payment-reconcile.service', () => ({
  finalizeSuccessfulPayment: vi.fn(),
}))
import { coachingAvailability } from './coaching.service'
const now = new Date('2030-01-01T00:00:00+07:00')
const startAt = new Date('2030-01-02T10:00:00Z'),
  endAt = new Date('2030-01-02T11:00:00Z')
const candidate = (id: string, type = 'COACH') => ({
  id,
  staffId: id,
  type,
  price: 150000,
  additionalHourPrice: 100000,
  startAt,
  endAt,
  staff: { id, name: id, coachType: 'PADEL', coachingGroups: [] },
})
const run = () =>
  coachingAvailability(
    'detail',
    '2030-01-02 10:00:00',
    '2030-01-02 11:00:00',
    now,
  )
beforeEach(() => {
  vi.resetAllMocks()
  mocks.range.mockResolvedValue([])
  mocks.detail.mockResolvedValue({
    id: 'detail',
    slotId: 'court-slot',
    bookingId: 'root',
    slot: { startAt, endAt, court: { sport: 'PADEL' } },
    booking: { status: 'CONFIRMED', branchId: 'cemara' },
  })
  mocks.slots
    .mockResolvedValueOnce([
      candidate('coach'),
      candidate('busy'),
      candidate('ballboy', 'BALLBOY'),
    ])
    .mockResolvedValue([{ staffId: 'busy' }])
  mocks.ballboy.mockResolvedValue(null)
  mocks.previous.mockResolvedValue([
    { slot: { staffId: 'coach', endAt: startAt } },
  ])
})
it('reads only the selected booking hour, excludes occupied people and preserves extension pricing', async () => {
  const options = await run()
  expect(mocks.global).not.toHaveBeenCalled()
  expect(mocks.range).toHaveBeenCalledWith(
    'cemara',
    'PADEL',
    startAt,
    endAt,
    now,
  )
  expect(options.map(({ slotId, price }) => ({ slotId, price }))).toEqual([
    { slotId: 'coach', price: 100000 },
    { slotId: 'ballboy', price: 150000 },
  ])
  expect(mocks.slots.mock.calls[0][0].where).toMatchObject({
    branchId: 'cemara',
    startAt,
    endAt,
    isAvailable: true,
    scheduleClosed: false,
  })
  expect(mocks.previous).toHaveBeenCalledTimes(1)
})
it('uses a single extension-price query regardless of coach count', async () => {
  mocks.slots
    .mockReset()
    .mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, i) => candidate(`coach-${i}`)),
    )
    .mockResolvedValue([])
  expect(await run()).toHaveLength(30)
  expect(mocks.slots).toHaveBeenCalledTimes(2)
  expect(mocks.previous).toHaveBeenCalledTimes(1)
})
it('rejects invalid or expired hours before any schedule maintenance', async () => {
  await expect(
    coachingAvailability(
      'detail',
      '2030-01-02 09:00:00',
      '2030-01-02 10:00:00',
      now,
    ),
  ).rejects.toThrow('di dalam booking')
  expect(mocks.range).not.toHaveBeenCalled()
  expect(
    await coachingAvailability(
      'detail',
      '2030-01-02 10:00:00',
      '2030-01-02 11:00:00',
      new Date('2030-01-02T10:15:00+07:00'),
    ),
  ).toEqual([])
  expect(mocks.range).not.toHaveBeenCalled()
  expect(mocks.slots).not.toHaveBeenCalled()
})
it('does not offer a second ballboy linked to the same court interval', async () => {
  mocks.ballboy.mockResolvedValue({ id: 'already-attached' })
  expect((await run()).map((option) => option.kind)).toEqual(['COACH'])
})
it('avoids conflict and pricing queries for an empty candidate list', async () => {
  mocks.slots.mockReset().mockResolvedValue([])
  expect(await run()).toEqual([])
  expect(mocks.slots).toHaveBeenCalledTimes(1)
  expect(mocks.previous).not.toHaveBeenCalled()
})

it('excludes rolling profiles whose hour was removed from the current court or staff settings', async () => {
  mocks.range.mockResolvedValue(['closed-person'])
  await run()
  expect(mocks.slots.mock.calls[0][0].where.staffId).toEqual({
    notIn: ['closed-person'],
  })
})
