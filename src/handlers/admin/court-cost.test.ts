import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  court: vi.fn(),
  slots: vi.fn(),
  ensure: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    court: { findUnique: mocks.court },
    slot: { findMany: mocks.slots },
  },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/services/rolling-court-schedule.service', () => ({
  ensureRollingCourtSchedules: mocks.ensure,
}))
vi.mock('@/services/upload.service', () => ({
  getFileUrl: vi.fn(),
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
}))
vi.mock('@/services/costing.service', () => ({
  bulkUpdateCourtSlotPricing: vi.fn(),
  updateSlotPricing: vi.fn(),
}))
import { getCostHandler } from './court.handler'

const slot = (startAt: string, overrides = {}) => ({
  id: startAt,
  courtId: 'court',
  startAt: new Date(startAt),
  endAt: new Date(+new Date(startAt) + 3_600_000),
  price: 250000,
  discountPrice: 0,
  isAvailable: true,
  scheduleClosed: false,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  ...overrides,
})
const request = () =>
  (getCostHandler.at(-1) as any)(
    {
      req: { valid: () => ({ id: 'court' }) },
      var: { logger: { fatal: vi.fn() } },
      json: (body: any) => JSON.parse(JSON.stringify(body)),
    },
    vi.fn(),
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.court.mockResolvedValue({ id: 'court' })
  mocks.slots.mockResolvedValue([])
})

it('keeps December 1 evening slots on December 1 through 24:00 without a phantom December 2 group', async () => {
  mocks.slots.mockResolvedValue([
    slot('2026-12-01T06:00:00Z'),
    ...Array.from({ length: 7 }, (_, i) => slot(`2026-12-01T${i + 17}:00:00Z`)),
  ])
  const { data } = await request()
  expect(data).toHaveLength(1)
  expect(data[0].date).toBe('2026-12-01T00:00:00.000Z')
  expect(data[0].slots[0].startAt).toBe('2026-12-01T06:00:00.000')
  expect(data[0].slots[1].startAt).toBe('2026-12-01T17:00:00.000')
  expect(data[0].slots.at(-1)).toMatchObject({
    startAt: '2026-12-01T23:00:00.000',
    endAt: '2026-12-02T00:00:00.000',
    price: 250000,
  })
})

it('returns one group per real slot date in descending order and retains closed/occupied statuses', async () => {
  mocks.slots.mockResolvedValue([
    slot('2026-10-31T19:00:00Z', { id: 'booked', isAvailable: false }),
    slot('2026-10-31T20:00:00Z', { id: 'closed', scheduleClosed: true }),
    slot('2026-11-01T06:00:00Z', { id: 'open', discountPrice: 150000 }),
  ])
  const { data } = await request()
  expect(data.map((group: any) => group.date)).toEqual([
    '2026-11-01T00:00:00.000Z',
    '2026-10-31T00:00:00.000Z',
  ])
  expect(data[0].slots[0]).toMatchObject({
    id: 'open',
    isAvailable: true,
    discountPrice: 150000,
  })
  expect(
    data[1].slots.map((s: any) => ({ id: s.id, isAvailable: s.isAvailable })),
  ).toEqual([
    { id: 'booked', isAvailable: false },
    { id: 'closed', isAvailable: false },
  ])
  expect(mocks.slots.mock.calls[0][0].where).toEqual({ courtId: 'court' })
})

it('returns an empty schedule for a court without slots', async () => {
  expect((await request()).data).toEqual([])
})

it('rejects a court outside the accessible scope before reading its slots', async () => {
  mocks.court.mockResolvedValue(null)
  await expect(request()).rejects.toThrow('Court not found')
  expect(mocks.slots).not.toHaveBeenCalled()
})
