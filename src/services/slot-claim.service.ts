import { BadRequestException } from '@/exceptions'
import type { Prisma, SlotType } from '@prisma/client'

type Tx = Prisma.TransactionClient

/**
 * Atomically claim slots by flipping isAvailable true → false.
 * Concurrent checkouts cannot both succeed for the same slots.
 */
export async function claimSlotsAtomically(
  tx: Tx,
  {
    slotIds,
    type,
    startsAfter,
    unavailableMessage = 'One or more slots not found or unavailable',
  }: {
    slotIds: string[]
    type: SlotType
    startsAfter?: Date
    unavailableMessage?: string
  },
): Promise<void> {
  if (slotIds.length === 0) {
    return
  }

  const uniqueSlotIds = Array.from(new Set(slotIds))
  const claimed = await tx.slot.updateMany({
    where: {
      id: { in: uniqueSlotIds },
      type,
      isAvailable: true,
      ...(startsAfter ? { startAt: { gt: startsAfter } } : {}),
    },
    data: {
      isAvailable: false,
    },
  })

  if (claimed.count !== uniqueSlotIds.length) {
    throw new BadRequestException(unavailableMessage)
  }
}

/**
 * Release slots held by a booking that is being rebuilt/cleared.
 */
export async function releaseSlotsByIds(
  tx: Tx,
  slotIds: string[],
): Promise<void> {
  const uniqueSlotIds = Array.from(new Set(slotIds.filter(Boolean)))
  if (uniqueSlotIds.length === 0) {
    return
  }

  await tx.slot.updateMany({
    where: { id: { in: uniqueSlotIds } },
    data: { isAvailable: true },
  })
}
