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
