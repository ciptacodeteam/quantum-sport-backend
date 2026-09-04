import { BadRequestException } from '@/exceptions'
import { SlotType } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { claimSlotsAtomically } from './slot-claim.service'

describe('claimSlotsAtomically', () => {
  it('only claims available slots that start after the checkout cutoff', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const cutoff = new Date('2026-09-03T14:37:00.000Z')

    await claimSlotsAtomically({ slot: { updateMany } } as never, {
      slotIds: ['slot-1'],
      type: SlotType.COURT,
      startsAfter: cutoff,
    })

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['slot-1'] },
        type: SlotType.COURT,
        isAvailable: true,
        startAt: { gt: cutoff },
      },
      data: { isAvailable: false },
    })
  })

  it('rejects the claim when a slot is unavailable or has already started', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })

    await expect(
      claimSlotsAtomically({ slot: { updateMany } } as never, {
        slotIds: ['slot-1'],
        type: SlotType.COURT,
        startsAfter: new Date('2026-09-03T14:37:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
