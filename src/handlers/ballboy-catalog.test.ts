import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ staff: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: { staff: { findMany: mocks.staff } } }))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/services/rolling-court-schedule.service', () => ({
  ensureRollingCourtSchedules: vi.fn(),
}))
import { getBallboysHandler } from './ballboy.handler'
it('lists publicly bookable active ballboys for either sport even when they have no available hours', async () => {
  mocks.staff.mockResolvedValue([
    { id: 'budi', name: 'Budi' },
    { id: 'fully-booked', name: 'Andi' },
  ])
  const response = await (getBallboysHandler.at(-1) as any)({
    json: (body: unknown) => body,
  })
  expect(mocks.staff).toHaveBeenCalledWith({
    where: {
      role: 'BALLBOY',
      isActive: true,
      adminServiceOnly: false,
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  expect(response.data).toHaveLength(2)
})
