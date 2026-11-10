import { isInHouseService } from '@/lib/inhouse-coaching'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { db } from '@/lib/prisma'

/** Manual settlement of the venue's payable to the coach's club, per service line. */
export async function setCoachClubSettlement(
  id: string,
  input: { isSettled: boolean; expectedIsSettled: boolean },
  actorId: string,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    const initial = await tx.bookingCoach.findFirst({ where: { id } })
    if (!initial)
      throw new NotFoundException(
        'Pemesanan coach tidak ditemukan di cabang ini.',
      )
    // Follow the booking lock used by cancellations and coach replacements.
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${initial.bookingId} FOR UPDATE`
    const current = await tx.bookingCoach.findFirst({
      where: { id },
      include: {
        bookingCoachType: true,
        inHouseUsage: true,
        booking: { include: { invoice: true } },
      },
    })
    if (!current)
      throw new NotFoundException(
        'Pemesanan coach tidak ditemukan di cabang ini.',
      )
    if (isInHouseService(current))
      throw new BadRequestException(
        'Paket in-house dicatat pada laporan in-house, bukan settlement club.',
      )
    if (current.isClubSettled !== input.expectedIsSettled)
      throw new BadRequestException(
        'Status lunas ke club telah berubah. Muat ulang data sebelum mengubahnya.',
      )
    if (
      input.isSettled &&
      (current.status !== 'CONFIRMED' ||
        current.booking.status !== 'CONFIRMED' ||
        current.booking.invoice?.status !== 'PAID')
    )
      throw new BadRequestException(
        'Hanya sesi coach terkonfirmasi dengan invoice lunas yang dapat ditandai lunas ke club.',
      )
    if (current.isClubSettled === input.isSettled) return current
    return tx.bookingCoach.update({
      where: { id },
      data: {
        isClubSettled: input.isSettled,
        clubSettlementUpdatedAt: now,
        clubSettlementUpdatedById: actorId,
      },
    })
  })
}
