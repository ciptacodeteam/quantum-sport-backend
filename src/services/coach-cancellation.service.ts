import { isInHouseService } from '@/lib/inhouse-coaching'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { courtBookingCutoff } from '@/lib/booking-time-policy'
import { formatClubWallClock } from '@/lib/club-time'
import type { Prisma } from '@prisma/client'

async function cancellationContext(
  client: Pick<Prisma.TransactionClient, 'bookingCoach'>,
  id: string,
  now: Date,
) {
  const item = await client.bookingCoach.findFirst({
    where: { id },
    include: {
      bookingCoachType: true,
      inHouseUsage: true,
      slot: { include: { staff: { select: { id: true, name: true } } } },
      booking: { include: { invoice: true } },
    },
  })
  if (!item)
    throw new NotFoundException(
      'Pemesanan coach tidak ditemukan di cabang ini.',
    )
  if (isInHouseService(item))
    throw new BadRequestException(
      'Sesi paket in-house sudah mencakup lapangan. Batalkan booking lapangan agar jadwal dan kuota dikembalikan bersama.',
    )
  if (item.status !== 'CONFIRMED' && item.status !== 'HOLD')
    throw new BadRequestException('Pemesanan coach sudah dibatalkan.')
  if (item.slot.startAt <= courtBookingCutoff(now))
    throw new BadRequestException('Jadwal melewati batas pembatalan 15 menit.')
  if (
    item.booking.status === 'CONFIRMED' &&
    item.booking.invoice &&
    item.booking.invoice.total > 0 &&
    item.booking.invoice.status !== 'PAID'
  )
    throw new BadRequestException(
      'Invoice belum lunas. Selesaikan atau batalkan invoice terlebih dahulu.',
    )
  return item
}
export async function previewCoachCancellation(id: string, now = new Date()) {
  const item = await cancellationContext(db, id, now)
  return {
    current: {
      id: item.id,
      slotId: item.slotId,
      name: item.slot.staff?.name ?? 'Coach',
      price: item.price,
      startAt: formatClubWallClock(item.slot.startAt),
      endAt: formatClubWallClock(item.slot.endAt),
    },
    invoiceNumber: item.booking.invoice?.number ?? null,
    refundRequired: item.price > 0 && item.booking.invoice?.status === 'PAID',
  }
}
export async function cancelBookedCoach(
  id: string,
  input: { expectedSlotId: string; reason: string },
  actorId: string,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    const initial = await cancellationContext(tx, id, now)
    if (initial.booking.serviceForBookingId)
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${initial.booking.serviceForBookingId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${initial.bookingId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM booking_coaches WHERE id = ${id} FOR UPDATE`
    const item = await cancellationContext(tx, id, now)
    if (item.slotId !== input.expectedSlotId)
      throw new BadRequestException(
        'Coach sudah diganti. Muat ulang sebelum membatalkan.',
      )
    if (item.slot.staffId)
      await tx.$queryRaw`SELECT id FROM staff WHERE id = ${item.slot.staffId} FOR UPDATE`
    const changed = await tx.bookingCoach.updateMany({
      where: { id, slotId: input.expectedSlotId, status: item.status },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancellationReason: input.reason,
      },
    })
    if (changed.count !== 1)
      throw new BadRequestException(
        'Pemesanan berubah. Muat ulang sebelum membatalkan.',
      )
    const released = await tx.slot.updateMany({
      where: {
        id: item.slotId,
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
    const refundRequired =
      item.price > 0 && item.booking.invoice?.status === 'PAID'
    const audit = `[${now.toISOString()}] Batalkan coach: ${item.slot.staff?.name ?? item.slot.staffId} (${item.id}); admin ${actorId}; alasan: ${input.reason}${refundRequired ? `; perlu tinjau refund manual Rp ${item.price}, invoice ${item.booking.invoice!.number}` : ''}`
    await tx.booking.update({
      where: { id: item.bookingId },
      data: {
        adminNote: [item.booking.adminNote, audit].filter(Boolean).join('\n'),
      },
    })
    // Keep paid invoice/payment amounts intact: cancellation is not a refund.
    return {
      id,
      bookingId: item.bookingId,
      name: item.slot.staff?.name ?? 'Coach',
      price: item.price,
      status: 'CANCELLED',
      refundRequired,
      slotReleased: released.count > 0,
    }
  })
}
