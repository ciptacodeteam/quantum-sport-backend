import { BookingStatus, SlotType } from '@prisma/client'
import dayjs from '@/lib/club-time'
import { db } from '@/lib/prisma'
import type { BulkDisableCourtSlotsSchema } from '@/lib/validation'

export async function bulkDisableCourtSlots({
  courtId,
  fromDate,
  toDate,
  days,
  startHour,
  endHour,
}: BulkDisableCourtSlotsSchema & { courtId: string }) {
  return db.$transaction(async (tx) => {
    const slots = await tx.slot.findMany({
      where: {
        courtId,
        type: SlotType.COURT,
        startAt: {
          gte: dayjs(fromDate).startOf('day').toDate(),
          lte: dayjs(toDate).endOf('day').toDate(),
        },
      },
      select: { id: true, startAt: true },
    })
    const matched = slots.filter((slot) => {
      const start = dayjs(slot.startAt)
      const day = start.day() || 7
      return (
        days.includes(day) &&
        start.hour() >= startHour &&
        start.hour() < endHour
      )
    })

    // Recheck availability and bookings in the write so concurrent checkouts
    // cannot have their slots changed by this operation.
    const updated = matched.length
      ? await tx.slot.updateMany({
          where: {
            id: { in: matched.map((slot) => slot.id) },
            courtId,
            type: SlotType.COURT,
            isAvailable: true,
            scheduleClosed: false,
            bookingDetails: {
              none: { booking: { status: { not: BookingStatus.CANCELLED } } },
            },
          },
          data: { isAvailable: false },
        })
      : { count: 0 }

    return {
      matchedCount: matched.length,
      updatedCount: updated.count,
      skippedCount: matched.length - updated.count,
    }
  })
}
