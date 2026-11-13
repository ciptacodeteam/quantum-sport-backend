import { Prisma } from '@prisma/client'
import { HTTPException } from 'hono/http-exception'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { lockCustomerWallet } from '@/services/membership-renewal.service'
import { branchContext, withBranchContext } from '@/lib/branch-context'
import { db } from '@/lib/prisma'
import { clubWallTime } from '@/lib/club-time'
import { appendCourtChangeAudit } from '@/lib/booking-reschedule-audit'
import { courtBookingCutoff } from '@/lib/booking-time-policy'
import { bookableCourtWhere } from '@/lib/court-branch-policy'
import { rollingBookingWindowWhere } from '@/lib/rolling-booking-window'

const detailInclude = {
  slot: { include: { court: true } },
  booking: { include: { invoice: true } },
} satisfies Prisma.BookingDetailInclude

type Detail = Prisma.BookingDetailGetPayload<{ include: typeof detailInclude }>
const conflict = () =>
  new HTTPException(409, {
    message:
      'Jadwal telah berubah atau lapangan baru saja dipesan. Muat ulang lalu pilih lagi.',
  })

function assertMovable(detail: Detail, now: Date) {
  if (
    detail.booking.status !== 'CONFIRMED' ||
    detail.booking.purpose !== 'REGULAR' ||
    detail.booking.invoice?.status !== 'PAID'
  )
    throw new BadRequestException(
      'Hanya booking reguler terkonfirmasi dan lunas yang dapat dipindahkan.',
    )
  if (detail.slot.startAt <= courtBookingCutoff(now))
    throw new BadRequestException(
      'Pindah court hanya tersedia sebelum 30 menit setelah jam mulai booking.',
    )
  if (!detail.slot.court || detail.slot.type !== 'COURT')
    throw new BadRequestException('Booking lapangan tidak valid.')
}

function targetWhere(detail: Detail, now: Date): Prisma.SlotWhereInput {
  return {
    ...rollingBookingWindowWhere(now),
    branchId: detail.booking.branchId,
    type: 'COURT',
    courtId: { not: detail.slot.courtId },
    court: {
      ...bookableCourtWhere,
      branchId: detail.booking.branchId,
      sport: detail.slot.court!.sport,
      branch: { isActive: true },
    },
    startAt: detail.slot.startAt,
    endAt: detail.slot.endAt,
    isAvailable: true,
    bookingDetails: { none: { booking: { status: { not: 'CANCELLED' } } } },
  }
}
function samePrice(
  detail: Detail,
  target: { price: number; discountPrice: number },
) {
  // Membership usage and invoice amounts stay attached to the original detail.
  if (detail.booking.membershipUserId && detail.discountPrice === 0)
    return target.price === detail.price
  return (
    (target.discountPrice > 0 ? target.discountPrice : target.price) ===
    (detail.discountPrice > 0 ? detail.discountPrice : detail.price)
  )
}

async function getCourtChangeOptions(
  branchId: string,
  detailId: string,
  now = new Date(),
) {
  const detail = await db.bookingDetail.findFirst({
    where: { id: detailId, booking: { branchId } },
    include: detailInclude,
  })
  if (!detail) throw new NotFoundException('Booking tidak ditemukan.')
  assertMovable(detail, now)
  const targets = await db.slot.findMany({
    where: targetWhere(detail, now),
    include: { court: true },
    orderBy: { court: { name: 'asc' } },
  })
  // A legacy schedule can contain overlapping rows with different start times.
  const occupied = await db.slot.findMany({
    where: {
      branchId,
      type: 'COURT',
      courtId: { in: targets.map((slot) => slot.courtId!).filter(Boolean) },
      startAt: { lt: detail.slot.endAt },
      endAt: { gt: detail.slot.startAt },
      bookingDetails: { some: { booking: { status: { not: 'CANCELLED' } } } },
    },
    select: { courtId: true },
  })
  const blocked = new Set(occupied.map((slot) => slot.courtId))
  return targets
    .filter((slot) => samePrice(detail, slot) && !blocked.has(slot.courtId))
    .map((slot) => ({
      slotId: slot.id,
      courtId: slot.courtId!,
      courtName: slot.court!.name,
    }))
}

async function changeCourt(
  adminId: string,
  branchId: string,
  detailId: string,
  input: { sourceSlotId: string; newSlotId: string },
  now?: Date,
) {
  try {
    return await db.$transaction(
      async (tx) => {
        // Match cancellation/renewal lock order: customer wallet, then booking.
        const owned = await tx.bookingDetail.findFirst({
          where: { id: detailId, booking: { branchId } },
          select: {
            bookingId: true,
            booking: {
              select: { userId: true, invoice: { select: { userId: true } } },
            },
          },
        })
        if (!owned) throw new NotFoundException('Booking tidak ditemukan.')
        const ownerId = owned.booking.userId ?? owned.booking.invoice?.userId
        if (ownerId) await lockCustomerWallet(tx, ownerId)
        // Shared booking lock serializes changes with cancellation and other moves.
        await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${owned.bookingId} FOR UPDATE`
        const detail = await tx.bookingDetail.findFirst({
          where: { id: detailId, booking: { branchId } },
          include: detailInclude,
        })
        if (!detail) throw new NotFoundException('Booking tidak ditemukan.')
        const evaluatedAt = now ?? new Date()
        assertMovable(detail, evaluatedAt)
        if (detail.slotId !== input.sourceSlotId) throw conflict()
        const target = await tx.slot.findFirst({
          where: { ...targetWhere(detail, evaluatedAt), id: input.newSlotId },
          include: { court: true },
        })
        if (!target || !samePrice(detail, target))
          throw new BadRequestException(
            'Pilih lapangan kosong pada cabang, olahraga, tanggal, jam, dan tarif yang sama.',
          )
        const overlap = await tx.slot.findFirst({
          where: {
            branchId,
            type: 'COURT',
            courtId: target.courtId,
            startAt: { lt: target.endAt },
            endAt: { gt: target.startAt },
            bookingDetails: {
              some: { booking: { status: { not: 'CANCELLED' } } },
            },
          },
          select: { id: true },
        })
        if (overlap) throw conflict()
        // Conditional claim is the same guard used by checkout. Never release first.
        assertMovable(detail, now ?? new Date())
        const claimed = await tx.slot.updateMany({
          where: { ...targetWhere(detail, evaluatedAt), id: target.id },
          data: { isAvailable: false },
        })
        if (claimed.count !== 1) throw conflict()
        const moved = await tx.bookingDetail.updateMany({
          where: {
            id: detail.id,
            bookingId: detail.bookingId,
            slotId: input.sourceSlotId,
          },
          data: { slotId: target.id, courtId: target.courtId },
        })
        if (moved.count !== 1) throw conflict()
        const relatedBooking: Prisma.BookingWhereInput = {
          branchId,
          OR: [
            { id: detail.bookingId },
            { serviceForBookingId: detail.bookingId },
          ],
        }
        // Keep add-ons, including separately purchased services, linked to the new court.
        await tx.bookingCoach.updateMany({
          where: {
            courtSlotId: detail.slotId,
            booking: relatedBooking,
            status: { not: 'CANCELLED' },
          },
          data: { courtSlotId: target.id },
        })
        await tx.bookingBallboy.updateMany({
          where: {
            courtSlotId: detail.slotId,
            booking: relatedBooking,
            status: { not: 'CANCELLED' },
          },
          data: { courtSlotId: target.id },
        })
        await tx.bookingInventory.updateMany({
          where: { slotId: detail.slotId, booking: relatedBooking },
          data: { slotId: target.id },
        })
        // Reopen only when no other active legacy detail still references the source.
        await tx.slot.updateMany({
          where: {
            id: detail.slotId,
            branchId,
            scheduleClosed: false,
            bookingDetails: {
              none: { booking: { status: { not: 'CANCELLED' } } },
            },
          },
          data: { isAvailable: true },
        })
        const audit = {
          at: evaluatedAt.toISOString(),
          actorId: adminId,
          bookingId: detail.bookingId,
          from: {
            court: detail.slot.court!.name,
            slotId: detail.slotId,
            startAt: clubWallTime(detail.slot.startAt).format(),
            endAt: clubWallTime(detail.slot.endAt).format(),
          },
          to: {
            court: target.court!.name,
            slotId: target.id,
            startAt: clubWallTime(target.startAt).format(),
            endAt: clubWallTime(target.endAt).format(),
          },
        }
        await tx.booking.update({
          where: { id: detail.bookingId },
          data: {
            adminNote: appendCourtChangeAudit(detail.booking.adminNote, audit),
          },
        })
        return {
          detailId: detail.id,
          slotId: target.id,
          courtId: target.courtId,
          courtName: target.court!.name,
        }
      },
      { isolationLevel: 'Serializable' },
    )
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2034'
    )
      throw conflict()
    throw error
  }
}

async function inAdminBookingBranch<T>(
  detailId: string,
  branchId: string | null,
  callback: (id: string) => Promise<T>,
) {
  const detail = await db.bookingDetail.findFirst({
    where: { id: detailId, ...(branchId ? { booking: { branchId } } : {}) },
    select: { booking: { select: { branchId: true } } },
  })
  if (!detail) throw new NotFoundException('Booking tidak ditemukan.')
  const actualBranch = detail.booking.branchId
  const context = branchContext.getStore()
  if (context && !context.branchId && context.isSuperAdmin)
    return withBranchContext({ ...context, branchId: actualBranch }, () =>
      callback(actualBranch),
    )
  return callback(actualBranch)
}
export function getAdminCourtChangeOptions(
  _adminId: string,
  branchId: string | null,
  detailId: string,
  now = new Date(),
) {
  return inAdminBookingBranch(detailId, branchId, (actualBranch) =>
    getCourtChangeOptions(actualBranch, detailId, now),
  )
}
export function changeAdminCourt(
  adminId: string,
  branchId: string | null,
  detailId: string,
  input: { sourceSlotId: string; newSlotId: string },
  now?: Date,
) {
  return inAdminBookingBranch(detailId, branchId, (actualBranch) =>
    changeCourt(adminId, actualBranch, detailId, input, now),
  )
}
