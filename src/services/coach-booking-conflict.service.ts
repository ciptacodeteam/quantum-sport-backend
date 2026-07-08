import { BookingStatus, SlotType } from '@prisma/client'
import dayjs from 'dayjs'

type CoachSlotLike = {
  id: string
  staffId: string | null
  startAt: Date
  endAt: Date
}

function overlaps(
  first: { startAt: Date; endAt: Date },
  second: { startAt: Date; endAt: Date },
) {
  return (
    dayjs(first.startAt).valueOf() < dayjs(second.endAt).valueOf() &&
    dayjs(first.endAt).valueOf() > dayjs(second.startAt).valueOf()
  )
}

function getSlotRange(slots: CoachSlotLike[]) {
  const starts = slots.map((slot) => dayjs(slot.startAt).valueOf())
  const ends = slots.map((slot) => dayjs(slot.endAt).valueOf())

  return {
    startAt: dayjs(Math.min(...starts)).toDate(),
    endAt: dayjs(Math.max(...ends)).toDate(),
  }
}

async function getActiveBookedCoachSlots(db: any, slots: CoachSlotLike[]) {
  if (slots.length === 0) {
    return []
  }

  const staffIds = Array.from(
    new Set(
      slots
        .map((slot) => slot.staffId)
        .filter((staffId): staffId is string => Boolean(staffId)),
    ),
  )

  if (staffIds.length === 0) {
    return []
  }

  const range = getSlotRange(slots)

  return db.bookingCoach.findMany({
    where: {
      booking: {
        status: {
          not: BookingStatus.CANCELLED,
        },
      },
      slot: {
        type: SlotType.COACH,
        staffId: {
          in: staffIds,
        },
        startAt: {
          lt: range.endAt,
        },
        endAt: {
          gt: range.startAt,
        },
      },
    },
    include: {
      slot: {
        select: {
          id: true,
          staffId: true,
          startAt: true,
          endAt: true,
        },
      },
    },
  })
}

export async function filterCoachSlotsWithoutBookingConflicts<T extends CoachSlotLike>(
  db: any,
  slots: T[],
): Promise<T[]> {
  const bookedCoachSlots = await getActiveBookedCoachSlots(db, slots)

  if (bookedCoachSlots.length === 0) {
    return slots
  }

  return slots.filter((slot) => {
    return !bookedCoachSlots.some(
      (bookingCoach: { slot: CoachSlotLike }) =>
        bookingCoach.slot.id !== slot.id &&
        bookingCoach.slot.staffId === slot.staffId &&
        overlaps(bookingCoach.slot, slot),
    )
  })
}

export async function assertCoachSlotsDoNotConflict(
  db: any,
  slots: CoachSlotLike[],
) {
  for (let index = 0; index < slots.length; index += 1) {
    const current = slots[index]
    if (!current.staffId) {
      continue
    }

    const hasSelectedOverlap = slots.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.staffId === current.staffId &&
        overlaps(current, other),
    )

    if (hasSelectedOverlap) {
      throw new Error('Coach cannot be booked for overlapping padel and tennis schedules')
    }
  }

  const bookedCoachSlots = await getActiveBookedCoachSlots(db, slots)
  const hasExistingOverlap = slots.some((slot) =>
    bookedCoachSlots.some(
      (bookingCoach: { slot: CoachSlotLike }) =>
        bookingCoach.slot.id !== slot.id &&
        bookingCoach.slot.staffId === slot.staffId &&
        overlaps(bookingCoach.slot, slot),
    ),
  )

  if (hasExistingOverlap) {
    throw new Error('Coach is already booked in another padel or tennis schedule at this time')
  }
}
