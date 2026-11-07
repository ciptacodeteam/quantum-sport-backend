import type { Prisma } from '@prisma/client'
/** Only a confirmed preceding hour in the same court booking can qualify an extension. */
export async function linkedCoachSessionPrice(
  tx: Pick<Prisma.TransactionClient, 'bookingCoach'>,
  slot: {
    price: number
    additionalHourPrice?: number | null
    staffId: string | null
    startAt: Date
    endAt: Date
  },
  courtBookingId: string,
) {
  if (
    slot.additionalHourPrice == null ||
    !slot.staffId ||
    +slot.endAt - +slot.startAt !== 3600000
  )
    return slot.price
  const previous = await tx.bookingCoach.findFirst({
    where: {
      status: 'CONFIRMED',
      booking: { status: 'CONFIRMED' },
      OR: [
        { bookingId: courtBookingId },
        { booking: { serviceForBookingId: courtBookingId } },
      ],
      slot: { staffId: slot.staffId, endAt: slot.startAt },
    },
    select: { id: true },
  })
  return previous ? slot.additionalHourPrice : slot.price
}

/** Batch the adjacent-hour lookup when showing many coaches for one court booking. */
export async function linkedCoachSessionPrices(
  tx: Pick<Prisma.TransactionClient, 'bookingCoach'>,
  slots: {
    id: string
    price: number
    additionalHourPrice?: number | null
    staffId: string | null
    startAt: Date
    endAt: Date
  }[],
  courtBookingId: string,
) {
  const prices = new Map(slots.map((slot) => [slot.id, slot.price]))
  const extensions = slots.filter(
    (slot) =>
      slot.additionalHourPrice != null &&
      slot.staffId &&
      +slot.endAt - +slot.startAt === 3600000,
  )
  if (!extensions.length) return prices
  const previous = await tx.bookingCoach.findMany({
    where: {
      status: 'CONFIRMED',
      booking: { status: 'CONFIRMED' },
      OR: [
        { bookingId: courtBookingId },
        { booking: { serviceForBookingId: courtBookingId } },
      ],
      slot: {
        OR: extensions.map((slot) => ({
          staffId: slot.staffId,
          endAt: slot.startAt,
        })),
      },
    },
    select: { slot: { select: { staffId: true, endAt: true } } },
  })
  const adjacent = new Set(
    previous.map(({ slot }) => `${slot.staffId}|${+slot.endAt}`),
  )
  for (const slot of extensions)
    if (adjacent.has(`${slot.staffId}|${+slot.startAt}`))
      prices.set(slot.id, slot.additionalHourPrice!)
  return prices
}
