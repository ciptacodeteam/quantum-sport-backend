import { BookingStatus, type Prisma } from '@prisma/client'
import { log } from '@/lib/logger'
import { restoreMembershipSessionsForCancelledBooking } from '@/services/membership-booking.service'

type Tx = Prisma.TransactionClient

/**
 * Cancel a HOLD booking once and release its court/coach/ballboy slots,
 * restore inventory, and restore membership sessions when applicable.
 *
 * Idempotent: if the booking is no longer HOLD, resources are left untouched.
 */
export async function cancelHoldBookingAndReleaseResources(
  tx: Tx,
  {
    bookingId,
    reason,
    now = new Date(),
  }: {
    bookingId: string
    reason: string
    now?: Date
  },
): Promise<{ cancelled: boolean }> {
  const cancelledBooking = await tx.booking.updateMany({
    where: {
      id: bookingId,
      status: BookingStatus.HOLD,
    },
    data: {
      status: BookingStatus.CANCELLED,
      cancellationReason: reason,
      cancelledAt: now,
    },
  })

  if (cancelledBooking.count === 0) {
    return { cancelled: false }
  }

  const bookingDetails = await tx.bookingDetail.findMany({
    where: { bookingId },
    select: { slotId: true },
  })
  const coachDetails = await tx.bookingCoach.findMany({
    where: { bookingId },
    select: { slotId: true },
  })
  const ballboyDetails = await tx.bookingBallboy.findMany({
    where: { bookingId },
    select: { slotId: true },
  })

  const allSlotIds = [
    ...bookingDetails.map((detail) => detail.slotId),
    ...coachDetails.map((coach) => coach.slotId),
    ...ballboyDetails.map((ballboy) => ballboy.slotId),
  ]

  if (allSlotIds.length > 0) {
    await tx.slot.updateMany({
      where: { id: { in: allSlotIds } },
      data: { isAvailable: true },
    })
    log.info(
      `Released ${allSlotIds.length} slots for booking ${bookingId} (${reason})`,
    )
  }

  await tx.bookingBallboy.updateMany({
    where: {
      bookingId,
      status: { not: BookingStatus.CANCELLED },
    },
    data: {
      status: BookingStatus.CANCELLED,
      cancellationReason: reason,
      cancelledAt: now,
    },
  })

  await tx.bookingCoach.updateMany({
    where: {
      bookingId,
      status: { not: BookingStatus.CANCELLED },
    },
    data: {
      status: BookingStatus.CANCELLED,
      cancellationReason: reason,
      cancelledAt: now,
    },
  })

  const bookingInventories = await tx.bookingInventory.findMany({
    where: {
      bookingId,
      returnedAt: null,
    },
  })

  for (const bookingInv of bookingInventories) {
    const marked = await tx.bookingInventory.updateMany({
      where: {
        id: bookingInv.id,
        returnedAt: null,
      },
      data: { returnedAt: now },
    })

    if (marked.count === 0) {
      continue
    }

    await tx.inventory.update({
      where: { id: bookingInv.inventoryId },
      data: {
        quantity: { increment: bookingInv.quantity },
      },
    })
    log.info(
      `Restored inventory ${bookingInv.inventoryId} by ${bookingInv.quantity} for booking ${bookingId} (${reason})`,
    )
  }

  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      membershipUserId: true,
      membershipSessionsUsed: true,
    },
  })

  if (booking) {
    await restoreMembershipSessionsForCancelledBooking(tx, booking)
  }

  return { cancelled: true }
}

/**
 * Cancel a HOLD class booking once and restore class capacity.
 */
export async function cancelHoldClassBookingAndRestoreCapacity(
  tx: Tx,
  {
    classBookingId,
    reason,
    now = new Date(),
  }: {
    classBookingId: string
    reason: string
    now?: Date
  },
): Promise<{ cancelled: boolean }> {
  const classBooking = await tx.classBooking.findUnique({
    where: { id: classBookingId },
    select: {
      id: true,
      classId: true,
      status: true,
    },
  })

  if (!classBooking || classBooking.status !== BookingStatus.HOLD) {
    return { cancelled: false }
  }

  const cancelled = await tx.classBooking.updateMany({
    where: {
      id: classBookingId,
      status: BookingStatus.HOLD,
    },
    data: {
      status: BookingStatus.CANCELLED,
      cancellationReason: reason,
      cancelledAt: now,
    },
  })

  if (cancelled.count === 0) {
    return { cancelled: false }
  }

  await tx.class.update({
    where: { id: classBooking.classId },
    data: {
      remaining: { increment: 1 },
    },
  })

  return { cancelled: true }
}
