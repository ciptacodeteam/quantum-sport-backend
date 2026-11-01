import { describe, expect, it, vi } from 'vitest'
import { lockStaffSlots } from './staff-slot-claim.service'
const slot = (id: string, staffId = 'a', hour = 13) => ({
  id,
  staffId,
  staff: { role: 'COACH', isActive: true },
  startAt: new Date(`2026-11-01T${hour}:00:00Z`),
  endAt: new Date(`2026-11-01T${hour + 1}:00:00Z`),
})
const txFor = (slots: ReturnType<typeof slot>[], conflict: unknown = null) => ({
  $queryRaw: vi.fn().mockResolvedValue([]),
  slot: {
    findMany: vi.fn().mockResolvedValue(slots),
    findFirst: vi.fn().mockResolvedValue(conflict),
  },
})
describe('person-level slot locking', () => {
  it('locks staff in a stable order and permits adjacent hours', async () => {
    const tx = txFor([slot('1', 'b'), slot('2', 'a'), slot('3', 'a', 14)])
    await lockStaffSlots(tx as never, ['1', '2', '3'], 'COACH')
    expect(tx.$queryRaw.mock.calls.map((args) => args[1])).toEqual(['a', 'b'])
    expect(tx.slot.findFirst).toHaveBeenCalledTimes(3)
  })
  it('rejects overlapping slots with distinct IDs for one person', async () => {
    await expect(
      lockStaffSlots(
        txFor([slot('1'), slot('2')]) as never,
        ['1', '2'],
        'COACH',
      ),
    ).rejects.toThrow('bertumpang tindih')
  })
  it('rejects existing booked overlaps including the same slot', async () => {
    await expect(
      lockStaffSlots(txFor([slot('1')], { id: '1' }) as never, ['1'], 'COACH'),
    ).rejects.toThrow('sudah dipesan')
  })
  it('rejects inactive staff, wrong roles and missing slots', async () => {
    const inactive = slot('1')
    inactive.staff.isActive = false
    await expect(
      lockStaffSlots(txFor([inactive]) as never, ['1'], 'COACH'),
    ).rejects.toThrow('tidak aktif')
    await expect(
      lockStaffSlots(txFor([slot('1')]) as never, ['1'], 'BALLBOY'),
    ).rejects.toThrow('tidak aktif')
    await expect(
      lockStaffSlots(txFor([]) as never, ['1'], 'COACH'),
    ).rejects.toThrow('tidak aktif')
  })
})
