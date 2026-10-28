import { BadRequestException } from '@/exceptions'

export function assertClientCheckoutHasNoAddOns(selection: {
  coachSlots?: unknown[]
  ballboySlots?: unknown[]
  inventories?: unknown[]
}) {
  if (
    [selection.coachSlots, selection.ballboySlots, selection.inventories].some(
      (items) => items && items.length > 0,
    )
  ) {
    throw new BadRequestException('Add-ons hanya dapat dipesan melalui admin.')
  }
}
