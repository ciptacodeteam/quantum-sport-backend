import { db } from '@/lib/prisma'

type BallboySlot = {
  id: string
  staffId: string | null
  startAt: Date
  endAt: Date
}

/** A person can have overlapping schedule rows; a booking blocks every overlapping row. */
export async function filterAvailableBallboySlots<T extends BallboySlot>(
  slots: T[],
): Promise<T[]> {
  if (!slots.length) return slots
  const bookings = await db.bookingBallboy.findMany({
    where: {
      status: { not: 'CANCELLED' },
      booking: { status: { not: 'CANCELLED' } },
      slot: {
        staffId: {
          in: [
            ...new Set(
              slots
                .map((slot) => slot.staffId)
                .filter((id): id is string => !!id),
            ),
          ],
        },
        startAt: {
          lt: new Date(Math.max(...slots.map((slot) => slot.endAt.getTime()))),
        },
        endAt: {
          gt: new Date(
            Math.min(...slots.map((slot) => slot.startAt.getTime())),
          ),
        },
      },
    },
    select: { slot: { select: { staffId: true, startAt: true, endAt: true } } },
  })
  return slots.filter(
    (slot) =>
      !bookings.some(
        ({ slot: booked }) =>
          booked.staffId === slot.staffId &&
          booked.startAt < slot.endAt &&
          booked.endAt > slot.startAt,
      ),
  )
}
