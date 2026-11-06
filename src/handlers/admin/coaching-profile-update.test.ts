import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  existing: {} as any,
  tx: {
    $queryRaw: vi.fn(),
    bookingBallboy: { count: vi.fn() },
    bookingCoach: { count: vi.fn() },
    staff: { update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({
  db: { $transaction: (fn: any) => fn(mocks.tx) },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: any[]) => handlers },
}))
vi.mock('@/services/coaching.service', () => ({
  getCoachingPerson: async () => mocks.existing,
  coachingSelect: {},
  coachingAvailability: vi.fn(),
  coachingSchedule: vi.fn(),
  saveCoachingSchedule: vi.fn(),
  saveRollingCoachingSchedule: vi.fn(),
  attachCoachingService: vi.fn(),
}))
vi.mock('@/services/coaching-group.service', () => ({
  validateCoachGroups: vi.fn(),
}))
vi.mock('@/services/coach-cancellation.service', () => ({
  previewCoachCancellation: vi.fn(),
}))
vi.mock('@/services/coach-replacement.service', () => ({
  availableCoachReplacements: vi.fn(),
  replaceBookedCoach: vi.fn(),
}))
import { updateCoachingHandler } from './coaching.handler'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.existing = {
    id: 'ballboy',
    branchId: 'cemara',
    role: 'BALLBOY',
    coachType: 'TENNIS',
  }
  mocks.tx.bookingBallboy.count.mockResolvedValue(1)
  mocks.tx.bookingCoach.count.mockResolvedValue(1)
  mocks.tx.staff.update.mockImplementation(async (args) => args.data)
})
async function update(coachType: string, kind = 'BALLBOY') {
  const handler = updateCoachingHandler.at(-1) as any
  return handler({
    req: {
      valid: (target: string) =>
        target === 'param'
          ? { id: 'ballboy' }
          : { kind, coachType, name: 'Ballboy Ibnu', isActive: true },
    },
    json: (value: any) => value,
  })
}
it.each(['PADEL', 'TENNIS', null])(
  'allows ballboy %s to support both sports despite existing bookings',
  async (currentSport) => {
    mocks.existing.coachType = currentSport
    await update('PADEL_TENNIS')
    expect(mocks.tx.staff.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coachType: 'PADEL_TENNIS' }),
      }),
    )
    expect(mocks.tx.bookingBallboy.count).not.toHaveBeenCalled()
  },
)
it('allows coaches to add a sport without invalidating bookings', async () => {
  mocks.existing.role = 'COACH'
  await update('PADEL_TENNIS', 'COACH')
  expect(mocks.tx.staff.update).toHaveBeenCalledOnce()
  expect(mocks.tx.bookingCoach.count).not.toHaveBeenCalled()
})
it.each([
  ['PADEL_TENNIS', 'PADEL'],
  ['PADEL_TENNIS', 'TENNIS'],
  ['TENNIS', 'PADEL'],
  ['PADEL', 'TENNIS'],
])(
  'blocks removing a sport from %s to %s when booked',
  async (current, next) => {
    mocks.existing.coachType = current
    await expect(update(next)).rejects.toThrow('Olahraga tidak dapat diganti')
    expect(mocks.tx.staff.update).not.toHaveBeenCalled()
    expect(mocks.tx.bookingBallboy.count).toHaveBeenCalledWith({
      where: {
        slot: { staffId: 'ballboy' },
        status: { not: 'CANCELLED' },
        booking: { status: { not: 'CANCELLED' } },
      },
    })
  },
)
it('allows changing sport when there are no bookings', async () => {
  mocks.tx.bookingBallboy.count.mockResolvedValue(0)
  await update('PADEL')
  expect(mocks.tx.staff.update).toHaveBeenCalledOnce()
})
it('allows ordinary profile edits on booked ballboys', async () => {
  await update('TENNIS')
  expect(mocks.tx.staff.update).toHaveBeenCalledOnce()
  expect(mocks.tx.bookingBallboy.count).not.toHaveBeenCalled()
})
it('still rejects tennis support outside Cemara', async () => {
  mocks.existing.branchId = 'other'
  mocks.existing.coachType = 'PADEL'
  await expect(update('PADEL_TENNIS')).rejects.toThrow('Tennis hanya tersedia')
  expect(mocks.tx.staff.update).not.toHaveBeenCalled()
})
