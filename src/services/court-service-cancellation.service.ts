import { restoreInHouseUsage } from './inhouse-coaching.service'
import type { Prisma } from '@prisma/client'

/** Caller holds the court booking lock. Include legacy add-ons linked only by courtSlotId. */
export async function cancelCourtBookingServices(
  tx: Prisma.TransactionClient,
  bookingId: string,
  courtSlotIds: string[],
  reason: string,
  now = new Date(),
) {
  const where = {
    status: { not: 'CANCELLED' as const },
    OR: [
      { bookingId },
      { booking: { serviceForBookingId: bookingId } },
      ...(courtSlotIds.length ? [{ courtSlotId: { in: courtSlotIds } }] : []),
    ],
  }
  const readServices = () =>
    Promise.all([
      tx.bookingCoach.findMany({
        where,
        select: {
          inHouseUsage: { select: { id: true, walletId: true } },
          id: true,
          slotId: true,
          bookingId: true,
          slot: { select: { staffId: true } },
        },
      }),
      tx.bookingBallboy.findMany({
        where,
        select: {
          id: true,
          slotId: true,
          bookingId: true,
          slot: { select: { staffId: true } },
        },
      }),
    ])
  let [coaches, ballboys] = await readServices()
  const initialServices = [...coaches, ...ballboys]
  for (const id of [...new Set(initialServices.map((s) => s.bookingId))]
    .filter((id) => id !== bookingId)
    .sort())
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`
    // A replacement can finish while we wait on a legacy service booking lock.
  ;[coaches, ballboys] = await readServices()
  const services = [...coaches, ...ballboys]
  for (const walletId of [
    ...new Set(
      coaches.flatMap((coach) =>
        coach.inHouseUsage ? [coach.inHouseUsage.walletId] : [],
      ),
    ),
  ].sort())
    await tx.$queryRaw`SELECT id FROM inhouse_wallets WHERE id = ${walletId} FOR UPDATE`
  for (const id of [
    ...new Set(
      services.map((s) => s.slot.staffId).filter((id): id is string => !!id),
    ),
  ].sort())
    await tx.$queryRaw`SELECT id FROM staff WHERE id = ${id} FOR UPDATE`
  const data = {
    status: 'CANCELLED' as const,
    cancelledAt: now,
    cancellationReason: reason,
  }
  await tx.bookingCoach.updateMany({ where, data })
  for (const coach of coaches)
    if (coach.inHouseUsage)
      await restoreInHouseUsage(tx, coach.inHouseUsage.id, now)
  await tx.bookingBallboy.updateMany({ where, data })
  const slotIds = [...new Set(services.map((s) => s.slotId))]
  if (slotIds.length)
    await tx.slot.updateMany({
      where: {
        id: { in: slotIds },
        scheduleClosed: false,
        bookingCoaches: {
          none: {
            status: { not: 'CANCELLED' },
            booking: { status: { not: 'CANCELLED' } },
          },
        },
        bookingBallboys: {
          none: {
            status: { not: 'CANCELLED' },
            booking: { status: { not: 'CANCELLED' } },
          },
        },
      },
      data: { isAvailable: true },
    })
  // Paid add-on invoices are accounting history; cancellation is not an automatic refund.
  for (const id of [...new Set(services.map((s) => s.bookingId))].sort()) {
    const booking = await tx.booking.findUnique({
      where: { id },
      select: {
        adminNote: true,
        invoice: { select: { status: true, number: true } },
      },
    })
    const audit = `[${now.toISOString()}] Coach/ballboy dibatalkan otomatis karena booking lapangan ${bookingId} dibatalkan; alasan: ${reason}${booking?.invoice?.status === 'PAID' ? `; tinjau refund manual, invoice ${booking.invoice.number}` : ''}`
    await tx.booking.update({
      where: { id },
      data: {
        adminNote: [booking?.adminNote, audit].filter(Boolean).join('\n'),
      },
    })
  }
  return { coachSlots: coaches.length, ballboySlots: ballboys.length }
}
