import { BadRequestException, NotFoundException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { formatClubWallClock, toClubWallDate } from '@/lib/club-time'
import {
  assertCoachingSport,
  buildCoachingSlots,
  coachingScheduleSchema,
} from '@/lib/coaching-policy'
import {
  midtransService,
  isSupportedChannel,
  isPaidStatus,
} from './midtrans.service'
import { finalizeSuccessfulPayment } from './payment-reconcile.service'
import {
  paymentDeadline,
  PAYMENT_WINDOW_MINUTES,
} from '@/lib/booking-time-policy'
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
  isActive: true,
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
  from: string,
  to: string,
) {
  await getCoachingPerson(db, staffId)
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
      booking: { include: { invoice: true } },
    },
  })
  if (!detail?.slot.court)
    throw new NotFoundException('Booking lapangan tidak ditemukan.')
  if (detail.booking.status !== 'CONFIRMED')
    throw new BadRequestException(
      'Layanan hanya dapat ditambahkan ke booking lapangan terkonfirmasi.',
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
  const slots = await db.slot.findMany({
    where: {
      branchId: detail.booking.branchId,
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
        ...(sport === 'TENNIS'
          ? [
              {
                type: 'BALLBOY' as const,
                staff: { isActive: true, role: 'BALLBOY' as const },
              },
            ]
          : []),
      ],
    },
    include: { staff: { select: coachingSelect } },
    orderBy: [{ price: 'asc' }, { staffId: 'asc' }],
  })
  const busy = await db.slot.findMany({
    where: {
      staffId: { in: slots.map((s) => s.staffId!) },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...occupied,
    },
    select: { staffId: true },
  })
  const busyIds = new Set(busy.map((s) => s.staffId))
  const hasBallboy =
    sport === 'TENNIS' &&
    !!(await db.bookingBallboy.findFirst({
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
    }))
  return slots
    .filter(
      (s) => !busyIds.has(s.staffId) && !(hasBallboy && s.type === 'BALLBOY'),
    )
    .map((s) => ({
      slotId: s.id,
      staffId: s.staffId,
      name: s.staff!.name,
      kind: s.type,
      coachType: s.staff!.coachType,
      price: s.price,
      startAt: formatClubWallClock(s.startAt),
      endAt: formatClubWallClock(s.endAt),
    }))
}

/** One atomic service booking and invoice for a coach and/or ballboy. */
export async function attachCoachingService(
  detailId: string,
  slotId: string | string[],
  cashierId: string,
  paymentMethodId?: string,
  now = new Date(),
  manualPayment?: { method: 'EDC' | 'QRIS_STATIC'; received: boolean },
) {
  const slotIds = Array.isArray(slotId) ? slotId : [slotId]
  if (
    !slotIds.length ||
    slotIds.length > 2 ||
    new Set(slotIds).size !== slotIds.length
  )
    throw new BadRequestException('Pilih maksimal satu coach dan satu ballboy.')
  if (manualPayment && (!manualPayment.received || paymentMethodId))
    throw new BadRequestException(
      'Konfirmasi pembayaran EDC/QRIS Statis telah diterima.',
    )
  const number = await generateInvoiceNumber()
  return db.$transaction(async (tx) => {
    const detail = await coachingCourtDetail(tx, detailId)
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
    const selectedSlots: Prisma.SlotGetPayload<{ include: { staff: true } }>[] =
      []
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
        include: { staff: true },
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
      // At most one ballboy for each tennis court interval.
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
    const price = selectedSlots.reduce((sum, s) => sum + s.price, 0)
    const dueDate = paymentDeadline(now)
    const paid = price === 0 || !!manualPayment
    const method =
      manualPayment && price > 0
        ? await tx.paymentMethod.upsert({
            where: {
              name: manualPayment.method === 'EDC' ? 'EDC' : 'QRIS Statis',
            },
            create: {
              name: manualPayment.method === 'EDC' ? 'EDC' : 'QRIS Statis',
              channel: manualPayment.method,
              fees: 0,
              percentage: 0,
            },
            update: {},
          })
        : paid
          ? null
          : await tx.paymentMethod.findFirst({
              where: {
                isActive: true,
                ...(paymentMethodId ? { id: paymentMethodId } : {}),
              },
              orderBy: { sequence: 'asc' },
            })
    if (method && !method.isActive)
      throw new BadRequestException('Metode pembayaran tidak aktif.')
    if (!paid && (!method?.channel || !isSupportedChannel(method.channel)))
      throw new BadRequestException(
        'Pilih metode pembayaran layanan yang aktif.',
      )
    const baseFee =
      method && !manualPayment
        ? method.fees + Math.round((price * Number(method.percentage)) / 100)
        : 0
    const fee = baseFee + Math.round(baseFee * 0.11)
    const total = price + fee
    if (total > 2147483647)
      throw new BadRequestException('Total pembayaran terlalu besar.')
    const booking = await tx.booking.create({
      data: {
        branchId: detail.booking.branchId,
        userId: detail.booking.userId,
        serviceForBookingId: detail.bookingId,
        cashierId,
        status: paid ? 'CONFIRMED' : 'HOLD',
        holdExpiresAt: paid ? null : dueDate,
        totalPrice: price,
        processingFee: fee,
        adminNote: `Layanan untuk booking ${detail.bookingId}, lapangan ${detail.slot.court!.name}`,
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
            price: slot.price,
            status: paid ? 'CONFIRMED' : 'HOLD',
          },
        })
      } else
        await tx.bookingBallboy.create({
          data: {
            bookingId: booking.id,
            slotId: slot.id,
            courtSlotId: detail.slotId,
            price: slot.price,
            status: paid ? 'CONFIRMED' : 'HOLD',
          },
        })
    }
    const invoice = await tx.invoice.create({
      data: {
        branchId: detail.booking.branchId,
        bookingId: booking.id,
        userId: detail.booking.userId,
        number,
        subtotal: price,
        processingFee: fee,
        total,
        status: paid ? 'PAID' : 'PENDING',
        dueDate,
        issuedAt: now,
        paidAt: paid ? now : null,
      },
    })
    let settled = paid
    if (method && manualPayment) {
      const payment = await tx.payment.create({
        data: {
          paymentMethodId: method.id,
          status: 'PAID',
          amount: total,
          fees: 0,
          paidAt: now,
          meta: {
            source: 'ADMIN_SERVICE',
            channel: manualPayment.method,
            receivedBy: cashierId,
            receivedAt: now.toISOString(),
          },
        },
      })
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { paymentId: payment.id },
      })
    } else if (method) {
      const customer = await tx.user.findUniqueOrThrow({
        where: { id: detail.booking.userId },
        select: { name: true, email: true, phone: true },
      })
      const init = await midtransService.initiateCheckoutPayment({
        orderId: invoice.id,
        amount: total,
        channelCode: method.channel!,
        description: selectedSlots
          .map(
            (s) =>
              `${s.type === 'COACH' ? 'Coach' : 'Ballboy'} ${s.staff!.name}`,
          )
          .join(' + '),
        customer: {
          name: customer.name,
          email: customer.email ?? undefined,
          phone: customer.phone ?? undefined,
        },
        expiryMinutes: PAYMENT_WINDOW_MINUTES,
      })
      const payment = await tx.payment.create({
        data: {
          paymentMethodId: method.id,
          status: 'PENDING',
          amount: total,
          fees: fee,
          externalRef:
            init.mode === 'snap' ? init.orderId : init.charge.transaction_id,
          meta: init.meta as Prisma.InputJsonValue,
          dueDate,
        },
      })
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { paymentId: payment.id },
      })
      if (
        init.mode === 'core' &&
        isPaidStatus(init.charge.transaction_status, init.charge.fraud_status)
      ) {
        await finalizeSuccessfulPayment(tx, {
          invoiceId: invoice.id,
          paidAt: now,
        })
        settled = true
      }
    }
    return {
      bookingId: booking.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      total,
      status: settled ? 'PAID' : invoice.status,
      dueDate,
    }
  })
}
