import { BadRequestException } from '@/exceptions'

export function assertClientCheckoutAddOnsAllowed(selection: {
  coachSlots?: unknown[]
  ballboySlots?: unknown[]
  inventories?: unknown[]
}) {
  if (
    [selection.coachSlots, selection.inventories].some(
      (items) => items && items.length > 0,
    )
  ) {
    throw new BadRequestException(
      'Coach dan perlengkapan hanya dapat dipesan melalui admin.',
    )
  }
}
