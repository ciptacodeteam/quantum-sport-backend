import { isInHouseService } from '@/lib/inhouse-coaching'
import type { RescheduleCharge } from '@/lib/reschedule-charge'
import type { Prisma } from '@prisma/client'
import { BadRequestException } from '@/exceptions'
import { claimSlotsAtomically } from './slot-claim.service'

type TimeSlot = { id: string; startAt: Date; endAt: Date }
/** Caller is in the court reschedule transaction. Preserve service identities and paid prices. */
export async function rescheduleCourtServices(
  tx: Prisma.TransactionClient,
  bookingId: string,
  source: TimeSlot,
  target: TimeSlot,
  branchId: string,
  options: {
    preview?: boolean
    previousCharges?: RescheduleCharge[]
    targetInHouseCoachPrice?: number
  } = {},
) {
  const withinSource = {
    startAt: { lt: source.endAt },
    endAt: { gt: source.startAt },
  }
  const where = {
    status: { not: 'CANCELLED' as const },
    booking: { status: 'CONFIRMED' as const },
    OR: [
      { courtSlotId: source.id },
      { courtSlotId: null, bookingId, slot: withinSource },
      {
        courtSlotId: null,
        booking: { serviceForBookingId: bookingId },
        slot: withinSource,
      },
    ],
  }
  const [coaches, ballboys] = await Promise.all([
    tx.bookingCoach.findMany({
      where,
      include: {
        slot: { include: { staff: true } },
        bookingCoachType: true,
        inHouseUsage: true,
      },
    }),
    tx.bookingBallboy.findMany({
      where,
      include: { slot: { include: { staff: true } } },
    }),
  ])
  const services = [
    ...coaches.map((item) => ({ ...item, kind: 'COACH' as const })),
    ...ballboys.map((item) => ({ ...item, kind: 'BALLBOY' as const })),
  ]
  const chargeLines: RescheduleCharge['services'] = []
  if (!services.length)
    return {
      bookingIds: [] as string[],
      coachSlots: 0,
      ballboySlots: 0,
      chargeLines,
      hasClubCoach: false,
      hasInHouseCoach: false,
      hasPrepaidInHouse: false,
    }
  for (const id of [...new Set(services.map((item) => item.bookingId))]
    .filter((id) => id !== bookingId)
    .sort())
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`
  // Legacy services with no court linkage cannot be moved safely if parallel courts share this booking.
  if (services.some((item) => !item.courtSlotId)) {
    const simultaneous = await tx.bookingDetail.count({
      where: {
        bookingId,
        slot: { startAt: { lt: source.endAt }, endAt: { gt: source.startAt } },
      },
    })
    if (simultaneous > 1)
      throw new BadRequestException(
        'Layanan lama belum terhubung ke satu lapangan. Hubungkan layanan sebelum reschedule booking dengan lapangan paralel.',
      )
  }
  const moves: {
    id: string
    kind: 'COACH' | 'BALLBOY'
    oldSlotId: string
    newSlotId: string
  }[] = []
  for (const item of services) {
    if (item.slot.startAt < source.startAt || item.slot.endAt > source.endAt)
      throw new BadRequestException(
        'Waktu layanan melewati slot lapangan. Reschedule layanan dan lapangan harus diproses bersama.',
      )
    const startAt = new Date(
      +target.startAt + (+item.slot.startAt - +source.startAt),
    )
    const endAt = new Date(+startAt + (+item.slot.endAt - +item.slot.startAt))
    const sameTime =
      +startAt === +item.slot.startAt && +endAt === +item.slot.endAt
    const replacement = sameTime
      ? item.slot
      : await tx.slot.findFirst({
          where: {
            branchId,
            type: item.kind,
            staffId: item.slot.staffId,
            startAt,
            endAt,
            isAvailable: true,
            scheduleClosed: false,
            staff: { isActive: true, role: item.kind },
          },
        })
    if (!replacement)
      throw new BadRequestException(
        `${item.kind === 'COACH' ? 'Coach' : 'Ballboy'} yang dipesan tidak tersedia pada jadwal pengganti. Pilih jadwal lain.`,
      )
    const previousExtra = (options.previousCharges ?? [])
      .flatMap((charge) => charge.services)
      .filter((line) => line.serviceId === item.id)
      .reduce((sum, line) => sum + line.amount, 0)
    const inHouse = item.kind === 'COACH' && isInHouseService(item)
    const settled = item.kind === 'COACH' && item.isClubSettled
    const participants =
      item.kind === 'COACH'
        ? Number(
            item.description?.match(/Jumlah member: (\d+)/)?.[1] ??
              item.description?.match(/(\d+) peserta/)?.[1] ??
              1,
          )
        : 1
    const targetPrice = settled
      ? 0
      : inHouse
        ? item.inHouseUsage
          ? item.price
          : (options.targetInHouseCoachPrice ??
              replacement.price ??
              item.price ??
              0) +
            Math.max(0, participants - 1) * 100000
        : Math.max(0, replacement.price ?? item.price ?? 0) +
          (item.kind === 'COACH'
            ? Math.max(0, participants - 1) *
              (replacement.additionalHourPrice ?? replacement.price ?? 0)
            : 0)
    const amount =
      settled || sameTime
        ? 0
        : Math.max(0, targetPrice - (item.price ?? 0) - previousExtra)
    if (amount > 0)
      chargeLines.push({
        isInHouse: inHouse,
        serviceId: item.id,
        kind: item.kind,
        amount,
        staffId: item.slot.staffId,
        staffName: item.slot.staff?.name ?? item.kind,
        clubId: item.kind === 'COACH' ? (item.coachingGroupId ?? null) : null,
        clubName:
          item.kind === 'COACH' ? (item.coachingGroupName ?? null) : null,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      })
    moves.push({
      id: item.id,
      kind: item.kind,
      oldSlotId: item.slotId,
      newSlotId: replacement.id,
    })
  }
  const summary = {
    bookingIds: [...new Set(services.map((item) => item.bookingId))],
    coachSlots: coaches.length,
    ballboySlots: ballboys.length,
    chargeLines,
    hasClubCoach: coaches.some((item) => !isInHouseService(item)),
    hasInHouseCoach: coaches.some((item) => isInHouseService(item)),
    hasPrepaidInHouse: coaches.some((item) => !!item.inHouseUsage),
  }
  if (options.preview) return summary
  for (const type of ['COACH', 'BALLBOY'] as const) {
    const slotIds = moves
      .filter((move) => move.kind === type && move.oldSlotId !== move.newSlotId)
      .map((move) => move.newSlotId)
    if (slotIds.length)
      await claimSlotsAtomically(tx, {
        slotIds,
        type,
        unavailableMessage:
          'Jadwal layanan baru saja dipesan. Pilih jadwal lain.',
      })
  }
  for (const move of moves) {
    const data = { slotId: move.newSlotId, courtSlotId: target.id }
    if (move.kind === 'COACH')
      await tx.bookingCoach.update({ where: { id: move.id }, data })
    else await tx.bookingBallboy.update({ where: { id: move.id }, data })
  }
  const oldSlotIds = moves
    .filter((move) => move.oldSlotId !== move.newSlotId)
    .map((move) => move.oldSlotId)
  if (oldSlotIds.length)
    await tx.slot.updateMany({
      where: {
        id: { in: oldSlotIds },
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
  return summary
}
