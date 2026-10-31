import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  branch: vi.fn(),
  upsert: vi.fn(),
  refresh: vi.fn(),
  lock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    $transaction: async (fn: any) =>
      fn({
        branch: { findFirst: mocks.branch },
        tariffPeriod: { upsert: mocks.upsert },
        $queryRaw: mocks.lock,
      }),
  },
}))
vi.mock('./rolling-court-schedule.service', () => ({
  refreshTariffCourtSchedules: mocks.refresh,
}))
import { saveTariffPeriod } from './tariff-settings.service'
const input = {
  sport: 'PADEL' as const,
  effectiveFrom: '2026-11-01',
  happyStart: 6,
  happyEnd: 16,
  peakStart: 16,
  peakEnd: 24,
}
const now = new Date('2026-10-30T03:00:00Z')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.branch.mockResolvedValue({ id: 'cemara' })
  mocks.upsert.mockResolvedValue({ id: 'rule' })
})
it('saves and refreshes the same branch and sport atomically from the effective Jakarta date', async () => {
  await saveTariffPeriod('cemara', input, now)
  expect(mocks.lock).toHaveBeenCalled()
  expect(mocks.upsert.mock.calls[0][0].create).toEqual({
    ...input,
    branchId: 'cemara',
    effectiveFrom: new Date('2026-11-01T00:00:00Z'),
  })
  expect(mocks.refresh).toHaveBeenCalledWith(
    expect.anything(),
    'cemara',
    'PADEL',
    new Date('2026-10-31T17:00:00Z'),
    now,
  )
})
it('rejects historical edits and unsupported tennis branches before saving', async () => {
  await expect(
    saveTariffPeriod('cemara', { ...input, effectiveFrom: '2026-10-29' }, now),
  ).rejects.toThrow('sebelum hari ini')
  await expect(
    saveTariffPeriod('s-parman', { ...input, sport: 'TENNIS' }, now),
  ).rejects.toThrow('Tennis hanya')
  expect(mocks.upsert).not.toHaveBeenCalled()
})
it('rejects an inactive or missing branch', async () => {
  mocks.branch.mockResolvedValue(null)
  await expect(saveTariffPeriod('cemara', input, now)).rejects.toThrow(
    'Cabang tidak ditemukan',
  )
  expect(mocks.upsert).not.toHaveBeenCalled()
})
