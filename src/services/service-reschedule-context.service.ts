import { db } from '@/lib/prisma'
import { BadRequestException, NotFoundException } from '@/exceptions'

/** Resolve the court action for a service; the existing court transaction moves everything together. */
export async function serviceRescheduleContext(
  kind: 'COACH' | 'BALLBOY',
  id: string,
) {
  const include = {
    slot: true,
    booking: { include: { invoice: true } },
  } as const
  const item =
    kind === 'COACH'
      ? await db.bookingCoach.findFirst({ where: { id }, include })
      : await db.bookingBallboy.findFirst({ where: { id }, include })
  if (!item) throw new NotFoundException('Pemesanan layanan tidak ditemukan.')
  if (item.status !== 'CONFIRMED' || item.booking.status !== 'CONFIRMED')
    throw new BadRequestException(
      'Hanya booking aktif yang dapat dijadwalkan ulang.',
    )
  const details = await db.bookingDetail.findMany({
    where: {
      ...(item.booking.serviceForBookingId
        ? { bookingId: item.booking.serviceForBookingId }
        : !item.courtSlotId
          ? { bookingId: item.bookingId }
          : {}),
      ...(item.courtSlotId
        ? { slotId: item.courtSlotId }
        : {
            slot: {
              startAt: { lte: item.slot.startAt },
              endAt: { gte: item.slot.endAt },
            },
          }),
      booking: { status: 'CONFIRMED' },
    },
    include: {
      court: true,
      slot: { include: { court: true } },
      booking: { include: { invoice: true } },
    },
    take: 2,
  })
  if (details.length !== 1)
    throw new BadRequestException(
      'Layanan belum terhubung ke satu lapangan. Periksa booking lapangan terlebih dahulu.',
    )
  const { booking, ...detail } = details[0]!
  if (
    booking.userId &&
    item.booking.userId &&
    booking.userId !== item.booking.userId
  )
    throw new BadRequestException(
      'Pelanggan layanan tidak sesuai booking lapangan.',
    )
  if (
    (booking.invoice && booking.invoice.status !== 'PAID') ||
    (item.booking.invoice && item.booking.invoice.status !== 'PAID')
  )
    throw new BadRequestException('Pembayaran harus lunas sebelum reschedule.')
  return {
    detail,
    membershipCovered:
      (booking.membershipSessionsUsed ?? 0) > 0 &&
      (booking.courtDiscountPrice === 0 || detail.discountPrice === 0),
  }
}
