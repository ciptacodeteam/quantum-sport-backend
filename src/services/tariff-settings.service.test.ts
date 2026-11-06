import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  branch: vi.fn(),
  list: vi.fn(),
  upsert: vi.fn(),
  refresh: vi.fn(),
  lock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    $transaction: async (fn: any) =>
      fn({
        branch: { findFirst: mocks.branch },
        tariffPeriod: { upsert: mocks.upsert, findMany: mocks.list },
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
  mocks.list.mockResolvedValue([])
  mocks.refresh.mockResolvedValue(undefined)
  mocks.upsert.mockResolvedValue({ id: 'rule' })
})
it('saves and refreshes the same branch and sport atomically from the effective Jakarta date', async () => {
  await saveTariffPeriod('cemara', input, now)
  expect(mocks.lock).toHaveBeenCalled()
  expect(mocks.upsert.mock.calls[0][0].create).toEqual({
    ...input,
    happyAllDayDays: [],
    branchId: 'cemara',
    effectiveFrom: new Date('2026-11-01T00:00:00Z'),
  })
  expect(mocks.refresh).toHaveBeenCalledWith(
    expect.anything(),
    'cemara',
    'PADEL',
    new Date('2026-11-01T00:00:00Z'),
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

it('persists coaching amounts with the effective tariff rule on both create and update', async () => {
  const discounts = { happyCoachDiscount: 45000, peakCoachDiscount: 25000 }
  await saveTariffPeriod('cemara', { ...input, ...discounts }, now)
  expect(mocks.upsert.mock.calls[0][0].create).toMatchObject(discounts)
  expect(mocks.upsert.mock.calls[0][0].update).toMatchObject(discounts)
})

it('saves the first coaching discount with default hours without regenerating court slots', async () => {
  mocks.refresh.mockRejectedValue(new Error('unnecessary schedule rebuild'))
  await expect(
    saveTariffPeriod(
      'cemara',
      {
        ...input,
        happyEnd: 15,
        peakStart: 15,
        happyCoachDiscount: 50000,
        peakCoachDiscount: 100000,
      },
      now,
    ),
  ).resolves.toEqual({ id: 'rule' })
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(mocks.upsert.mock.calls[0][0].update).toMatchObject({
    happyCoachDiscount: 50000,
    peakCoachDiscount: 100000,
  })
})
it('skips regeneration when changing discounts on an existing non-default hour rule', async () => {
  mocks.list.mockResolvedValue([
    { ...input, id: 'existing', branchId: 'cemara', happyCoachDiscount: 10000 },
    {
      ...input,
      id: 'later',
      branchId: 'cemara',
      effectiveFrom: '2026-12-01',
      happyEnd: 17,
      peakStart: 17,
    },
  ])
  await saveTariffPeriod('cemara', { ...input, happyCoachDiscount: 50000 }, now)
  expect(mocks.refresh).not.toHaveBeenCalled()
})
it('compares hours against the rule effective on the playing date, rather than a later scheduled rule', async () => {
  mocks.list.mockResolvedValue([
    { ...input, branchId: 'cemara', effectiveFrom: '2026-10-01' },
    {
      ...input,
      branchId: 'cemara',
      effectiveFrom: '2026-12-01',
      happyEnd: 17,
      peakStart: 17,
    },
  ])
  await saveTariffPeriod(
    'cemara',
    { ...input, happyEnd: 17, peakStart: 17 },
    now,
  )
  expect(mocks.refresh).toHaveBeenCalledOnce()
})

it('refreshes slots when full Happy Hour days change even with unchanged hour bands', async () => {
  mocks.list.mockResolvedValue([
    { ...input, branchId: 'cemara', happyAllDayDays: [] },
  ])
  await saveTariffPeriod('cemara', { ...input, happyAllDayDays: [6, 7] }, now)
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(mocks.upsert.mock.calls[0][0].update.happyAllDayDays).toEqual([6, 7])
})
it('compares raw hour bands on weekends and skips discount-only regeneration', async () => {
  mocks.list.mockResolvedValue([
    { ...input, branchId: 'cemara', happyAllDayDays: [6, 7] },
  ])
  await saveTariffPeriod(
    'cemara',
    { ...input, happyAllDayDays: [7, 6], happyCoachDiscount: 50000 },
    now,
  )
  expect(mocks.refresh).not.toHaveBeenCalled()
})
it('refreshes slots when weekend Happy Hour is turned off', async () => {
  mocks.list.mockResolvedValue([
    { ...input, branchId: 'cemara', happyAllDayDays: [6, 7] },
  ])
  await saveTariffPeriod('cemara', { ...input, happyAllDayDays: [] }, now)
  expect(mocks.refresh).toHaveBeenCalledOnce()
})

it('preserves day rules when an older client saves a new date without that field', async () => {
  mocks.list.mockResolvedValue([
    { ...input, branchId: 'cemara', happyAllDayDays: [6, 7] },
  ])
  await saveTariffPeriod(
    'cemara',
    { ...input, effectiveFrom: '2026-11-08' },
    now,
  )
  expect(mocks.upsert.mock.calls[0][0].create.happyAllDayDays).toEqual([6, 7])
  expect(mocks.refresh).not.toHaveBeenCalled()
})
