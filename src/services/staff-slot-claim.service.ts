import { BadRequestException } from '@/exceptions'
import type { Prisma } from '@prisma/client'

/** Lock the person, not just one slot: different overlapping slot IDs must serialize too. */
export async function lockStaffSlots(
  tx: Prisma.TransactionClient,
  slotIds: string[],
  type: 'COACH' | 'BALLBOY',
) {
  const query = {
    where: { id: { in: slotIds }, type },
    include: { staff: true },
  } as const
  let selected = await tx.slot.findMany(query)
  if (
    selected.length !== slotIds.length ||
    selected.some(
      (s) => !s.staffId || !s.staff?.isActive || s.staff.role !== type,
    )
  )
    throw new BadRequestException(
      'Coach/ballboy tidak aktif atau slot tidak ditemukan.',
    )
  for (const id of [...new Set(selected.map((s) => s.staffId!))].sort())
    await tx.$queryRaw`SELECT id FROM staff WHERE id = ${id} FOR UPDATE`
  // Re-read after waiting for a concurrent profile edit or schedule update.
  selected = await tx.slot.findMany(query)
  if (
    selected.length !== slotIds.length ||
    selected.some((s) => !s.staff?.isActive || s.staff.role !== type)
  )
    throw new BadRequestException(
      'Coach/ballboy tidak aktif atau slot tidak ditemukan.',
    )
  for (const slot of selected) {
    if (
      selected.some(
        (other) =>
          other.id !== slot.id &&
          other.staffId === slot.staffId &&
          other.startAt < slot.endAt &&
          other.endAt > slot.startAt,
      )
    )
      throw new BadRequestException(
        'Satu coach/ballboy tidak dapat mengisi jadwal yang bertumpang tindih.',
      )
    const conflict = await tx.slot.findFirst({
      where: {
        staffId: slot.staffId,
        startAt: { lt: slot.endAt },
        endAt: { gt: slot.startAt },
        OR: [
          {
            bookingCoaches: {
              some: {
                status: { not: 'CANCELLED' },
                booking: { status: { not: 'CANCELLED' } },
              },
            },
          },
          {
            bookingBallboys: {
              some: {
                status: { not: 'CANCELLED' },
                booking: { status: { not: 'CANCELLED' } },
              },
            },
          },
        ],
      },
      select: { id: true },
    })
    if (conflict)
      throw new BadRequestException(
        'Coach/ballboy sudah dipesan pada waktu yang sama.',
      )
  }
}
