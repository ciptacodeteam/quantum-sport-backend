import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  courts: vi.fn(),
  services: vi.fn(),
  context: { branchId: 'a', isSuperAdmin: false },
}))
vi.mock('@/lib/branch-context', () => ({
  branchContext: { getStore: () => mocks.context },
}))
vi.mock('./rolling-court-schedule.service', () => ({
  ensureRollingCourtSchedules: mocks.courts,
}))
vi.mock('./rolling-service-schedule.service', () => ({
  ensureRollingServiceSchedules: mocks.services,
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.context.branchId = 'a'
  mocks.courts.mockResolvedValue(undefined)
  mocks.services.mockResolvedValue(undefined)
})
it('shares concurrent maintenance, skips coach reconciliation, and refreshes after a minute', async () => {
  const { ensureBallboySchedules } = await import('./ballboy-schedule.service')
  const now = new Date('2030-01-01T00:00:00Z')
  await Promise.all([ensureBallboySchedules(now), ensureBallboySchedules(now)])
  await ensureBallboySchedules(new Date(+now + 10000))
  expect(mocks.courts).toHaveBeenCalledTimes(1)
  expect(mocks.courts).toHaveBeenCalledWith(undefined, now, {
    includeServices: false,
  })
  expect(mocks.services).toHaveBeenCalledWith(now, 'BALLBOY')
  await ensureBallboySchedules(new Date(+now + 60000))
  expect(mocks.courts).toHaveBeenCalledTimes(2)
})
it('isolates branches and retries failed maintenance immediately', async () => {
  const { ensureBallboySchedules } = await import('./ballboy-schedule.service')
  const now = new Date('2030-01-01T00:00:00Z')
  await ensureBallboySchedules(now)
  mocks.context.branchId = 'b'
  mocks.courts.mockRejectedValueOnce(new Error('database unavailable'))
  await expect(ensureBallboySchedules(now)).rejects.toThrow(
    'database unavailable',
  )
  await ensureBallboySchedules(now)
  expect(mocks.courts).toHaveBeenCalledTimes(3)
})
