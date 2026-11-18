import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { $transaction: (fn: unknown) => mocks.transaction(fn) },
}))
import {
  deleteUnusedCoachingProfile,
  setCoachingProfileActive,
  canDeleteCoachingProfile,
} from './coaching-profile-lifecycle.service'
let tx: any
const empty = { slot: 0, inHouseWallets: 0, inHousePlans: 0, bookingCashier: 0 }
beforeEach(() => {
  vi.clearAllMocks()
  tx = {
    $queryRaw: vi.fn(),
    staff: {
      findFirst: vi.fn().mockResolvedValue({ id: 'coach', _count: empty }),
      delete: vi.fn(),
      update: vi.fn(),
    },
    coachingGroupCoach: { deleteMany: vi.fn() },
    coachTypeStaffPrice: { deleteMany: vi.fn() },
    inHousePlan: { deleteMany: vi.fn() },
    slot: { deleteMany: vi.fn() },
  }
  mocks.transaction.mockImplementation((fn: any) => fn(tx))
})
it('deletes an unused coach with empty schedules, unsold plans and catalog links', async () => {
  expect(await deleteUnusedCoachingProfile('coach')).toEqual({ id: 'coach' })
  expect(tx.staff.findFirst.mock.calls[0][0].where).toEqual({
    id: 'coach',
    role: 'COACH',
  })
  for (const delegate of [
    'coachingGroupCoach',
    'coachTypeStaffPrice',
    'inHousePlan',
    'slot',
  ])
    expect(tx[delegate].deleteMany).toHaveBeenCalledWith({
      where: { staffId: 'coach' },
    })
  expect(tx.staff.delete).toHaveBeenCalledWith({ where: { id: 'coach' } })
})
it.each(Object.keys(empty))(
  'blocks deletion when the coach has historical references in %s',
  async (key) => {
    const counts = { ...empty, [key]: 1 }
    expect(canDeleteCoachingProfile(counts)).toBe(false)
    tx.staff.findFirst.mockResolvedValue({ id: 'coach', _count: counts })
    await expect(deleteUnusedCoachingProfile('coach')).rejects.toThrow(
      'riwayat pemesanan',
    )
    expect(tx.staff.delete).not.toHaveBeenCalled()
    expect(tx.slot.deleteMany).not.toHaveBeenCalled()
  },
)
it('rejects a missing, out-of-branch or non-coach profile before mutation', async () => {
  tx.staff.findFirst.mockResolvedValue(null)
  await expect(deleteUnusedCoachingProfile('coach')).rejects.toThrow(
    'tidak ditemukan',
  )
  expect(tx.staff.delete).not.toHaveBeenCalled()
})
it.each([true, false])(
  'updates only active status to %s and keeps booking history',
  async (isActive) => {
    tx.staff.findFirst.mockResolvedValue({
      id: 'coach',
      _count: { ...empty, slot: 3 },
    })
    await setCoachingProfileActive('coach', isActive)
    expect(tx.staff.update).toHaveBeenCalledWith({
      where: { id: 'coach' },
      data: { isActive },
      select: { id: true, isActive: true },
    })
    expect(tx.staff.delete).not.toHaveBeenCalled()
    expect(tx.slot.deleteMany).not.toHaveBeenCalled()
  },
)
it('turns a concurrent FK reference into an actionable error after transaction rollback', async () => {
  mocks.transaction.mockRejectedValue({ code: 'P2003' })
  await expect(deleteUnusedCoachingProfile('coach')).rejects.toThrow(
    'tidak dapat dihapus',
  )
})
