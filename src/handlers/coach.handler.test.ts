import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { withBranchContext } from '@/lib/branch-context'

const mocks = vi.hoisted(() => ({
  maintenance: vi.fn(),
  range: vi.fn(),
  slots: vi.fn(),
  conflicts: vi.fn(),
}))
vi.mock('@/lib/create-app', async () => {
  const { createFactory } = await import('hono/factory')
  return { factory: createFactory() }
})
vi.mock('@/lib/prisma', () => ({ db: { slot: { findMany: mocks.slots } } }))
vi.mock('@/services/upload.service', () => ({ getFileUrl: vi.fn() }))
vi.mock('@/services/service-schedule-maintenance.service', () => ({
  ensureServiceSchedules: mocks.maintenance,
}))
vi.mock('@/services/service-schedule-range.service', () => ({
  ensureServiceScheduleRange: mocks.range,
}))
vi.mock('@/services/coach-booking-conflict.service', () => ({
  filterCoachSlotsWithoutBookingConflicts: mocks.conflicts,
}))
import { getAvailableCoachesHandler } from './coach.handler'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.range.mockResolvedValue(['excluded'])
  mocks.slots.mockResolvedValue([])
  mocks.conflicts.mockImplementation((_, slots) => slots)
})
function request(path = '/admin/coach/availability', end = '11:00:00') {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    c.set('logger', { fatal: vi.fn() })
    await next()
  })
  app.get(path, ...getAvailableCoachesHandler)
  const query = new URLSearchParams({
    startAt: '2030-01-02T10:00:00',
    endAt: `2030-01-02T${end}`,
    courtSport: 'PADEL',
  })
  return withBranchContext(
    { branchId: 'cemara', isAdmin: true, isSuperAdmin: false },
    () => app.request(`${path}?${query}`),
  )
}
it('checks only the requested coach hour and keeps availability and booking conflict filters', async () => {
  expect((await request()).status).toBe(200)
  expect(mocks.maintenance).not.toHaveBeenCalled()
  expect(mocks.range).toHaveBeenCalledWith(
    'cemara',
    'PADEL',
    new Date('2030-01-02T10:00:00Z'),
    new Date('2030-01-02T11:00:00Z'),
    expect.any(Date),
    'COACH',
  )
  expect(mocks.slots.mock.calls[0][0].where).toMatchObject({
    type: 'COACH',
    staffId: { notIn: ['excluded'] },
    isAvailable: true,
    scheduleClosed: false,
    bookingCoaches: { none: { status: { not: 'CANCELLED' } } },
  })
  expect(mocks.conflicts).toHaveBeenCalledTimes(1)
})
it.each([
  ['/coaches/availability', '11:00:00'],
  ['/admin/coach/availability', '12:00:00'],
])(
  'preserves maintenance for the broader availability request %s ending %s',
  async (path, end) => {
    expect((await request(path, end)).status).toBe(200)
    expect(mocks.maintenance).toHaveBeenCalledWith('COACH')
    expect(mocks.range).not.toHaveBeenCalled()
  },
)
