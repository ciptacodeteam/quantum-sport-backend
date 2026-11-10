import { isInHouseService } from '@/lib/inhouse-coaching'
import {
  coachingGroupMembershipSelect,
  eligibleCoachingGroups,
  resolveBookingCoachingGroup,
} from './coaching-group.service'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { courtBookingCutoff } from '@/lib/booking-time-policy'
import { formatClubWallClock } from '@/lib/club-time'
import { assertCoachingSport } from '@/lib/coaching-policy'
import { claimSlotsAtomically } from './slot-claim.service'
import type { Prisma, CourtSport } from '@prisma/client'

type Client = Pick<Prisma.TransactionClient, 'bookingCoach'>
async function getReplacementContext(client: Client, id: string, now: Date) {
  const current = await client.bookingCoach.findFirst({
    where: { id },
    include: {
      bookingCoachType: true,
      inHouseUsage: true,
      slot: { include: { staff: true } },
      courtSlot: { include: { court: true } },
      booking: {
        include: {
          details: { include: { court: true, slot: true } },
          serviceForBooking: true,
        },
      },
    },
  })
  if (!current)
    throw new NotFoundException(
      'Pemesanan coach tidak ditemukan di cabang ini.',
    )
  if (
    current.status !== 'CONFIRMED' ||
    current.booking.status !== 'CONFIRMED' ||
    (current.booking.serviceForBooking &&
      current.booking.serviceForBooking.status !== 'CONFIRMED')
  )
    throw new BadRequestException(
      'Coach hanya dapat diganti pada booking terkonfirmasi.',
    )
  if (isInHouseService(current))
    throw new BadRequestException(
      'Kuota paket terikat pada coach. Batalkan sesi untuk mengembalikan kuota, lalu booking ulang dengan coach paket yang sama.',
    )
  if (current.isClubSettled)
    throw new BadRequestException(
      'Batalkan tanda lunas ke club sebelum mengganti coach.',
    )
  if (current.slot.startAt <= courtBookingCutoff(now))
    throw new BadRequestException('Jadwal melewati batas perubahan 15 menit.')
  const sports: CourtSport[] = current.courtSlot?.court
    ? [current.courtSlot.court.sport]
    : [
        ...new Set(
          current.booking.details
            .filter(
              (d) =>
                d.court &&
                d.slot.startAt < current.slot.endAt &&
                d.slot.endAt > current.slot.startAt,
            )
            .map((d) => d.court!.sport),
        ),
      ]
  if (
    !sports.length &&
    (current.slot.staff?.coachType === 'PADEL' ||
      current.slot.staff?.coachType === 'TENNIS')
  )
    sports.push(current.slot.staff.coachType)
  if (!sports.length)
    throw new BadRequestException(
      'Olahraga booking belum dapat ditentukan. Hubungkan coach dengan lapangan terlebih dahulu.',
    )
  return { current, sports }
}

export async function availableCoachReplacements(id: string, now = new Date()) {
  const { current, sports } = await getReplacementContext(db, id, now)
  const options = await db.slot.findMany({
    where: {
      branchId: current.booking.branchId,
      type: 'COACH',
      startAt: current.slot.startAt,
      endAt: current.slot.endAt,
      price: current.price,
      isAvailable: true,
      scheduleClosed: false,
      staffId: { not: current.slot.staffId },
      staff: {
        isActive: true,
        role: 'COACH',
        AND: sports.map((sport) => ({
          coachType: { in: [sport, 'PADEL_TENNIS'] },
        })),
      },
    },
    include: {
      staff: {
        select: {
          id: true,
          name: true,
          coachType: true,
          coachingGroups: { select: coachingGroupMembershipSelect },
        },
      },
    },
    orderBy: { staffId: 'asc' },
  })
  const busy = await db.slot.findMany({
    where: {
      staffId: { in: options.map((s) => s.staffId!) },
      startAt: { lt: current.slot.endAt },
      endAt: { gt: current.slot.startAt },
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
    select: { staffId: true },
  })
  const busyIds = new Set(busy.map((s) => s.staffId))
  return {
    current: {
      id: current.id,
      slotId: current.slotId,
      name: current.slot.staff?.name ?? 'Coach',
      price: current.price,
      startAt: formatClubWallClock(current.slot.startAt),
      endAt: formatClubWallClock(current.slot.endAt),
      coachingGroupId: current.coachingGroupId,
      coachingGroupName: current.coachingGroupName,
    },
    options: options
      .filter((s) => !busyIds.has(s.staffId))
      .flatMap((s) => {
        const groups = eligibleCoachingGroups(
          s.staff!.coachingGroups,
          current.booking.branchId,
          sports,
        )
        const identities = s.staff!.coachingGroups?.length
          ? groups.map((g) => ({
              coachingGroupId: g.id,
              coachingGroupName: g.name,
            }))
          : [{ coachingGroupId: null, coachingGroupName: null }]
        return identities.map((group) => ({
          slotId: s.id,
          staffId: s.staffId!,
          name: s.staff!.name,
          price: s.price,
          ...group,
        }))
      }),
  }
}

export async function replaceBookedCoach(
  id: string,
  input: {
    slotId: string
    expectedSlotId: string
    reason?: string
    coachingGroupId?: string
  },
  actorId: string,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    const initial = await getReplacementContext(tx, id, now)
    // Use the same booking -> staff lock order as additions and cancellations.
    if (initial.current.booking.serviceForBookingId)
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${initial.current.booking.serviceForBookingId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${initial.current.bookingId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM booking_coaches WHERE id = ${id} FOR UPDATE`
    const { current, sports } = await getReplacementContext(tx, id, now)
    if (current.slotId !== input.expectedSlotId)
      throw new BadRequestException(
        'Coach sudah diubah. Muat ulang pilihan pengganti.',
      )
    const candidate = await tx.slot.findFirst({
      where: {
        id: input.slotId,
        branchId: current.booking.branchId,
        type: 'COACH',
      },
      select: { staffId: true },
    })
    if (!candidate?.staffId || candidate.staffId === current.slot.staffId)
      throw new BadRequestException('Pilih coach pengganti yang berbeda.')
    for (const staffId of [
      ...new Set(
        [current.slot.staffId, candidate.staffId].filter(
          (v): v is string => !!v,
        ),
      ),
    ].sort())
      await tx.$queryRaw`SELECT id FROM staff WHERE id = ${staffId} FOR UPDATE`
    // Re-read availability, schedule and tariff after acquiring locks.
    const replacement = await tx.slot.findFirst({
      where: {
        id: input.slotId,
        branchId: current.booking.branchId,
        type: 'COACH',
        isAvailable: true,
        scheduleClosed: false,
      },
      include: {
        staff: {
          include: {
            coachingGroups: { select: coachingGroupMembershipSelect },
          },
        },
      },
    })
    if (!replacement?.staff?.isActive || replacement.staff.role !== 'COACH')
      throw new BadRequestException('Coach pengganti tidak tersedia.')
    if (
      +replacement.startAt !== +current.slot.startAt ||
      +replacement.endAt !== +current.slot.endAt
    )
      throw new BadRequestException(
        'Jadwal coach pengganti harus sama dengan booking.',
      )
    if (replacement.price !== current.price)
      throw new BadRequestException(
        'Harga coach pengganti harus sama agar invoice tetap sesuai.',
      )
    for (const sport of sports)
      assertCoachingSport('COACH', replacement.staff.coachType, sport)
    const group = await resolveBookingCoachingGroup(
      tx,
      replacement.staff,
      current.booking.branchId,
      sports,
      input.coachingGroupId,
    )
    await claimSlotsAtomically(tx, {
      slotIds: [replacement.id],
      type: 'COACH',
      startsAfter: courtBookingCutoff(now),
    })
    const changed = await tx.bookingCoach.updateMany({
      where: { id, slotId: input.expectedSlotId, status: 'CONFIRMED' },
      data: { slotId: replacement.id, ...group },
    })
    if (changed.count !== 1)
      throw new BadRequestException(
        'Pemesanan berubah. Muat ulang sebelum mengganti coach.',
      )
    await tx.slot.updateMany({
      where: {
        id: current.slotId,
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
    const groupAudit = `; grup: ${current.coachingGroupName ?? 'Independen'} → ${group.coachingGroupName ?? 'Independen'}`
    const audit = `[${now.toISOString()}] Ganti coach: ${current.slot.staff?.name ?? current.slot.staffId} (${current.slotId}) → ${replacement.staff.name} (${replacement.id})${groupAudit}; admin ${actorId}${input.reason ? `; alasan: ${input.reason}` : ''}`
    await tx.booking.update({
      where: { id: current.bookingId },
      data: {
        adminNote: [current.booking.adminNote, audit]
          .filter(Boolean)
          .join('\n'),
      },
    })
    return {
      id,
      bookingId: current.bookingId,
      name: replacement.staff.name,
      slotId: replacement.id,
      price: current.price,
    }
  })
}
