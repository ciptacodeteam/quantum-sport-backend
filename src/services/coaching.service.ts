import { ensureServiceScheduleRange } from './service-schedule-range.service'
import {
  linkedCoachSessionPrice,
  linkedCoachSessionPrices,
} from './coach-session-pricing.service'
import { ensureRollingCourtSchedules } from './rolling-court-schedule.service'
import { reconcileRollingServiceSchedule } from './rolling-service-schedule.service'
import { rollingCoachingScheduleSchema } from '@/lib/coaching-policy'
import { clubWallDateString, clubNowAsWallDate } from '@/lib/club-time'
import { bookingWindowEnd } from '@/lib/rolling-booking-window'
import {
  coachingGroupMembershipSelect,
  eligibleCoachingGroups,
  resolveBookingCoachingGroup,
} from './coaching-group.service'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { formatClubWallClock, toClubWallDate } from '@/lib/club-time'
import {
  assertCoachingSport,
  buildCoachingSlots,
  coachingScheduleSchema,
} from '@/lib/coaching-policy'
import { courtBookingCutoff } from '@/lib/booking-time-policy'
import { claimSlotsAtomically } from './slot-claim.service'
import { generateInvoiceNumber } from '@/lib/utils'
import type { Prisma } from '@prisma/client'
import type { z } from 'zod'

export const coachingSelect = {
  id: true,
  branchId: true,
  name: true,
  phone: true,
  role: true,
  coachType: true,
  coachProfile: true,
  coachingGroups: { select: coachingGroupMembershipSelect },
  inHousePlans: { where: { isActive: true }, select: { id: true } },
  isActive: true,
  rollingServiceSchedule: true,
} satisfies Prisma.StaffSelect

export async function getCoachingPerson(
  client: Pick<Prisma.TransactionClient, 'staff'>,
  id: string,
) {
  const staff = await client.staff.findFirst({
    where: { id, role: { in: ['COACH', 'BALLBOY'] } },
    select: coachingSelect,
  })
  if (!staff)
    throw new NotFoundException('Coach/ballboy tidak ditemukan di cabang ini.')
  return staff
}

const activeCoaches = {
  status: { not: 'CANCELLED' as const },
  booking: { status: { not: 'CANCELLED' as const } },
}
const activeBallboys = {
  status: { not: 'CANCELLED' as const },
  booking: { status: { not: 'CANCELLED' as const } },
}
const occupied = {
  OR: [
    { bookingCoaches: { some: activeCoaches } },
    { bookingBallboys: { some: activeBallboys } },
  ],
} satisfies Prisma.SlotWhereInput

export async function saveCoachingSchedule(
  staffId: string,
  input: z.infer<typeof coachingScheduleSchema>,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    const staff = await getCoachingPerson(tx, staffId)
    await tx.$queryRaw`SELECT id FROM staff WHERE id = ${staffId} FOR UPDATE`
    const proposed = buildCoachingSlots(input, now)
    if (!proposed.length)
      throw new BadRequestException('Tidak ada jadwal mendatang yang cocok.')
    const existing = await tx.slot.findMany({
      where: {
        staffId,
        startAt: { lt: proposed.at(-1)!.endAt },
        endAt: { gt: proposed[0].startAt },
      },
      include: {
        bookingCoaches: { where: activeCoaches, select: { id: true } },
        bookingBallboys: { where: activeBallboys, select: { id: true } },
      },
    })
    let created = 0,
      updated = 0,
      skipped = 0
    for (const slot of proposed) {
      const overlaps = existing.filter(
        (s) => s.startAt < slot.endAt && s.endAt > slot.startAt,
      )
      if (
        overlaps.some(
          (s) => +s.startAt !== +slot.startAt || +s.endAt !== +slot.endAt,
        )
      )
        throw new BadRequestException(
          'Jadwal bertumpang tindih dengan slot lain. Gunakan slot satu jam yang sama.',
        )
      const old = overlaps[0]
      if (
        old &&
        (!old.isAvailable ||
          old.scheduleClosed ||
          old.bookingCoaches.length ||
          old.bookingBallboys.length)
      ) {
        skipped++
        continue
      }
      if (old) {
        await tx.slot.update({
          where: { id: old.id },
          data: { price: slot.price },
        })
        updated++
      } else {
        await tx.slot.create({
          data: {
            ...slot,
            staffId,
            branchId: staff.branchId,
            type: staff.role === 'COACH' ? 'COACH' : 'BALLBOY',
          },
        })
        created++
      }
    }
    return { created, updated, skipped }
  })
}

export async function coachingSchedule(
  staffId: string,
  from?: string,
  to?: string,
) {
  const person = await getCoachingPerson(db, staffId)
  if (person.rollingServiceSchedule || !from || !to)
    await ensureRollingCourtSchedules()
  from ??= clubWallDateString(clubNowAsWallDate())
  to ??= clubWallDateString(bookingWindowEnd(12))
  const slots = await db.slot.findMany({
    where: {
      staffId,
      startAt: {
        gte: toClubWallDate(`${from} 00:00:00`),
        lte: toClubWallDate(`${to} 23:59:59`),
      },
    },
    orderBy: { startAt: 'asc' },
    include: {
      bookingCoaches: { where: activeCoaches, select: { id: true } },
      bookingBallboys: { where: activeBallboys, select: { id: true } },
    },
  })
  return slots.map(({ bookingCoaches, bookingBallboys, ...s }) => ({
    ...s,
    startAt: formatClubWallClock(s.startAt),
    endAt: formatClubWallClock(s.endAt),
    isAvailable: s.isAvailable && !s.scheduleClosed,
    booked: !!(bookingCoaches.length || bookingBallboys.length),
  }))
}

export async function coachingCourtDetail(
  client: Pick<Prisma.TransactionClient, 'bookingDetail'>,
  detailId: string,
) {
  const detail = await client.bookingDetail.findFirst({
    where: { id: detailId },
    include: {
      slot: { include: { court: true } },
      booking: {
        include: {
          invoice: true,
          coaches: {
            where: { status: { not: 'CANCELLED' } },
            select: {
              courtSlotId: true,
              inHouseUsage: { select: { id: true, restoredAt: true } },
            },
          },
        },
      },
    },
  })
  if (!detail?.slot.court)
    throw new NotFoundException('Booking lapangan tidak ditemukan.')
  if (detail.booking.status !== 'CONFIRMED')
    throw new BadRequestException(
      'Layanan hanya dapat ditambahkan ke booking lapangan terkonfirmasi.',
    )
  if (
    detail.booking.coaches?.some(
      (item) =>
        item.courtSlotId === detail.slotId &&
        item.inHouseUsage &&
        !item.inHouseUsage.restoredAt,
    )
  )
    throw new BadRequestException(
      'Jam ini menggunakan paket in-house. Coach club tidak dapat ditambahkan pada jam yang sama.',
    )
  return detail
}

export async function coachingAvailability(
  detailId: string,
  start: string,
  end: string,
  now = new Date(),
) {
  const detail = await coachingCourtDetail(db, detailId)
  const startAt = toClubWallDate(start),
    endAt = toClubWallDate(end)
  if (
    startAt < detail.slot.startAt ||
    endAt > detail.slot.endAt ||
    +endAt - +startAt !== 3_600_000
  )
    throw new BadRequestException(
      'Waktu layanan harus satu jam di dalam booking lapangan.',
    )
  if (startAt <= courtBookingCutoff(now)) return []
  const sport = detail.slot.court!.sport
  const excludedStaffIds = await ensureServiceScheduleRange(
    detail.booking.branchId,
    sport,
    startAt,
    endAt,
    now,
  )
  const [slots, hasBallboyRow] = await Promise.all([
    db.slot.findMany({
      where: {
        branchId: detail.booking.branchId,
        ...(excludedStaffIds.length
          ? { staffId: { notIn: excludedStaffIds } }
          : {}),
        startAt,
        endAt,
        isAvailable: true,
        scheduleClosed: false,
        OR: [
          {
            type: 'COACH',
            staff: {
              isActive: true,
              role: 'COACH',
              coachType: { in: [sport, 'PADEL_TENNIS'] },
            },
          },
          {
            type: 'BALLBOY' as const,
            staff: {
              isActive: true,
              role: 'BALLBOY' as const,
            },
          },
        ],
      },
      include: { staff: { select: coachingSelect } },
      orderBy: [{ price: 'asc' }, { staffId: 'asc' }],
    }),
    db.bookingBallboy.findFirst({
      where: {
        courtSlotId: detail.slotId,
        OR: [
          { bookingId: detail.bookingId },
          { booking: { serviceForBookingId: detail.bookingId } },
        ],
        ...activeBallboys,
        slot: { startAt: { lt: endAt }, endAt: { gt: startAt } },
      },
      select: { id: true },
    }),
  ])
  if (!slots.length) return []
  const [busy, coachPrices] = await Promise.all([
    db.slot.findMany({
      where: {
        staffId: { in: slots.map((s) => s.staffId!) },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        ...occupied,
      },
      select: { staffId: true },
    }),
    linkedCoachSessionPrices(
      db,
      slots.filter((slot) => slot.type === 'COACH'),
      detail.bookingId,
    ),
  ])
  const busyIds = new Set(busy.map((s) => s.staffId))
  const hasBallboy = !!hasBallboyRow

  const options = slots
    .filter(
      (s) =>
        !busyIds.has(s.staffId) &&
        !(hasBallboy && s.type === 'BALLBOY') &&
        (s.type !== 'COACH' ||
          !s.staff?.coachingGroups?.length ||
          eligibleCoachingGroups(
            s.staff.coachingGroups,
            detail.booking.branchId,
            [sport],
          ).length > 0),
    )
    .map((s) => ({
      slotId: s.id,
      staffId: s.staffId,
      name: s.staff!.name,
      kind: s.type,
      coachType: s.staff!.coachType,
      groups:
        s.type === 'COACH'
          ? eligibleCoachingGroups(
              s.staff!.coachingGroups,
              detail.booking.branchId,
              [sport],
            )
          : [],
      price: s.price,
      additionalHourPrice: s.additionalHourPrice,
      startAt: formatClubWallClock(s.startAt),
      endAt: formatClubWallClock(s.endAt),
    }))
  return options.map((option) => ({
    ...option,
    price:
      option.kind === 'COACH' ? coachPrices.get(option.slotId)! : option.price,
  }))
}

/** One atomic service booking and invoice for a coach and/or ballboy. */
export async function attachCoachingService(
  detailId: string,
  slotId: string | string[],
  cashierId: string,
  _paymentMethodId?: string,
  now = new Date(),
  _manualPayment?: {
    method?: 'EDC' | 'QRIS_STATIC' | 'BANK_TRANSFER_MANUAL'
    received: boolean
  },
  coachingGroupId?: string,
) {
  const slotIds = Array.isArray(slotId) ? slotId : [slotId]
  if (
    !slotIds.length ||
    slotIds.length > 2 ||
    new Set(slotIds).size !== slotIds.length
  )
    throw new BadRequestException('Pilih maksimal satu coach dan satu ballboy.')
  const number = await generateInvoiceNumber()
  return db.$transaction(async (tx) => {
    const detail = await coachingCourtDetail(tx, detailId)
    const customerId = detail.booking.userId
    if (!customerId)
      throw new BadRequestException(
        'Layanan berbayar memerlukan booking dengan pelanggan.',
      )
    // Serialize additions/cancellation to this court booking as well as staff claims.
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${detail.bookingId} FOR UPDATE`
    await coachingCourtDetail(tx, detailId)
    const candidates = await tx.slot.findMany({
      where: {
        id: { in: slotIds },
        branchId: detail.booking.branchId,
        type: { in: ['COACH', 'BALLBOY'] },
      },
      select: { staffId: true },
    })
    if (
      candidates.length !== slotIds.length ||
      candidates.some((s) => !s.staffId)
    )
      throw new BadRequestException('Layanan tidak tersedia.')
    for (const staffId of [
      ...new Set(candidates.map((s) => s.staffId!)),
    ].sort())
      await tx.$queryRaw`SELECT id FROM staff WHERE id = ${staffId} FOR UPDATE`
    const selectedSlots: Prisma.SlotGetPayload<{
      include: {
        staff: {
          include: {
            coachingGroups: { select: typeof coachingGroupMembershipSelect }
          }
        }
      }
    }>[] = []
    for (const selectedId of slotIds) {
      // Profile, price and availability may have changed while this request waited.
      const slot = await tx.slot.findFirst({
        where: {
          id: selectedId,
          branchId: detail.booking.branchId,
          type: { in: ['COACH', 'BALLBOY'] },
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
      if (!slot?.staff?.isActive || slot.staff.role !== slot.type)
        throw new BadRequestException('Layanan tidak tersedia.')
      assertCoachingSport(
        slot.type,
        slot.staff.coachType,
        detail.slot.court!.sport,
      )
      if (
        slot.startAt < detail.slot.startAt ||
        slot.endAt > detail.slot.endAt ||
        +slot.endAt - +slot.startAt !== 3_600_000
      )
        throw new BadRequestException(
          'Slot layanan harus berada di dalam waktu booking lapangan.',
        )
      if (slot.startAt <= courtBookingCutoff(now))
        throw new BadRequestException('Slot melewati batas pemesanan 15 menit.')
      // At most one ballboy for each court interval.
      if (
        slot.type === 'BALLBOY' &&
        (await tx.bookingBallboy.findFirst({
          where: {
            courtSlotId: detail.slotId,
            OR: [
              { bookingId: detail.bookingId },
              { booking: { serviceForBookingId: detail.bookingId } },
            ],
            ...activeBallboys,
            slot: { startAt: { lt: slot.endAt }, endAt: { gt: slot.startAt } },
          },
          select: { id: true },
        }))
      )
        throw new BadRequestException(
          'Ballboy sudah ditambahkan untuk lapangan dan jam ini.',
        )
      await claimSlotsAtomically(tx, {
        slotIds: [slot.id],
        type: slot.type,
        startsAfter: courtBookingCutoff(now),
      })
      selectedSlots.push(slot)
    }
    if (
      new Set(selectedSlots.map((s) => s.type)).size !== selectedSlots.length ||
      selectedSlots.some(
        (s) =>
          +s.startAt !== +selectedSlots[0].startAt ||
          +s.endAt !== +selectedSlots[0].endAt,
      )
    )
      throw new BadRequestException(
        'Pilih satu coach dan satu ballboy pada jam yang sama.',
      )
    const coach = selectedSlots.find((s) => s.type === 'COACH')
    if (coachingGroupId && !coach)
      throw new BadRequestException('Pilih coach untuk grup coaching.')
    const group = coach
      ? await resolveBookingCoachingGroup(
          tx,
          coach.staff!,
          detail.booking.branchId,
          [detail.slot.court!.sport],
          coachingGroupId,
        )
      : null
    const coachPrice = coach
      ? await linkedCoachSessionPrice(tx, coach, detail.bookingId)
      : 0
    const price = selectedSlots.reduce(
      (sum, s) => sum + (s.type === 'COACH' ? coachPrice : s.price),
      0,
    )
    // Admin-added services are confirmed and recorded as paid without a payment method.
    const dueDate = now
    const fee = 0
    const total = price
    if (total > 2147483647)
      throw new BadRequestException('Total pembayaran terlalu besar.')
    const booking = await tx.booking.create({
      data: {
        branchId: detail.booking.branchId,
        userId: customerId,
        serviceForBookingId: detail.bookingId,
        cashierId,
        status: 'CONFIRMED',
        holdExpiresAt: null,
        totalPrice: price,
        processingFee: fee,
        adminNote: `Layanan untuk booking ${detail.bookingId}, lapangan ${detail.slot.court!.name}; dikonfirmasi lunas oleh ${cashierId} pada ${now.toISOString()} tanpa metode pembayaran`,
      },
    })
    for (const slot of selectedSlots) {
      if (slot.type === 'COACH') {
        const type = await tx.bookingCoachType.findFirst({
          where: { name: 'Coaching', isActive: true },
          select: { id: true },
        })
        if (!type)
          throw new BadRequestException(
            'Jalankan migrasi Coaching sebelum menambah layanan.',
          )
        await tx.bookingCoach.create({
          data: {
            bookingId: booking.id,
            slotId: slot.id,
            courtSlotId: detail.slotId,
            bookingCoachTypeId: type.id,
            ...group,
            price: coachPrice,
            status: 'CONFIRMED',
          },
        })
      } else
        await tx.bookingBallboy.create({
          data: {
            bookingId: booking.id,
            slotId: slot.id,
            courtSlotId: detail.slotId,
            price: slot.price,
            status: 'CONFIRMED',
          },
        })
    }
    const invoice = await tx.invoice.create({
      data: {
        branchId: detail.booking.branchId,
        bookingId: booking.id,
        userId: customerId,
        number,
        subtotal: price,
        processingFee: fee,
        total,
        status: 'PAID',
        dueDate,
        issuedAt: now,
        paidAt: now,
      },
    })
    return {
      bookingId: booking.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      total,
      status: 'PAID',
      dueDate,
    }
  })
}

export async function saveRollingCoachingSchedule(
  staffId: string,
  input: z.infer<typeof rollingCoachingScheduleSchema>,
  now = new Date(),
) {
  const config = rollingCoachingScheduleSchema.parse(input)
  await getCoachingPerson(db, staffId)
  await ensureRollingCourtSchedules(undefined, now)
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM staff WHERE id = ${staffId} FOR UPDATE`
    await getCoachingPerson(tx, staffId)
    const staff = await tx.staff.update({
      where: { id: staffId },
      data: { rollingServiceSchedule: config },
    })
    return reconcileRollingServiceSchedule(tx, staff, now, true)
  })
}
