import {
  managementInHouseRate,
  type ManagementCustomer,
} from '@/lib/management-pricing'
import { resolveTariffPeriod } from '@/lib/tariff-period'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/prisma'
import { BadRequestException, NotFoundException } from '@/exceptions'
import {
  inHousePlanSchema,
  INHOUSE_COACH_TYPE,
  priceInHouseHour,
  type InHouseSelection,
} from '@/lib/inhouse-coaching'
import { generateInvoiceNumber } from '@/lib/utils'
import { lockCustomerWallet } from './membership-renewal.service'
import { claimSlotsAtomically } from './slot-claim.service'
import { assertCoachingSport } from '@/lib/coaching-policy'
import { formatClubWallClock } from '@/lib/club-time'
import type { z } from 'zod'
import {
  getInHouseCourtDiscount,
  getInHouseCourtHourlyPrice,
} from './booking-bundle-discount.service'
import type { TariffRule } from '@/lib/tariff-period'

type Tx = Prisma.TransactionClient
export async function saveInHousePlan(
  id: string | undefined,
  input: z.infer<typeof inHousePlanSchema>,
) {
  return db.$transaction(async (tx) => {
    const coach = await tx.staff.findFirst({
      where: {
        id: input.staffId,
        role: 'COACH',
        isActive: true,
        isInHouseCoach: true,
      },
    })
    if (!coach)
      throw new BadRequestException(
        'Coach in-house aktif tidak ditemukan di cabang ini.',
      )
    if (id) {
      const previous = await tx.inHousePlan.findFirst({ where: { id } })
      if (!previous) throw new NotFoundException('Paket tidak ditemukan.')
      if (previous.staffId !== input.staffId)
        throw new BadRequestException(
          'Coach paket tidak dapat diganti. Buat paket baru untuk coach lain.',
        )
      return tx.inHousePlan.update({ where: { id }, data: input })
    }
    return tx.inHousePlan.create({
      data: { ...input, branchId: coach.branchId },
    })
  })
}
/** Cancel unused quota and its invoice atomically, preserving the payment history. */
export async function cancelUnusedInHouseWallet(id: string, actorId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM inhouse_wallets WHERE id = ${id} FOR UPDATE`
    const wallet = await tx.inHouseWallet.findFirst({
      where: { id },
      include: { _count: { select: { usages: true } } },
    })
    if (!wallet) throw new NotFoundException('Paket customer tidak ditemukan.')
    if (
      !wallet.deletedAt &&
      (wallet.remainingMinutes !== wallet.totalMinutes ||
        wallet._count.usages > 0)
    )
      throw new BadRequestException(
        'Paket yang sudah pernah dipakai tidak dapat dibatalkan.',
      )
    const cancelledAt = wallet.deletedAt ?? new Date()
    if (!wallet.deletedAt)
      await tx.inHouseWallet.update({
        where: { id },
        data: { deletedAt: cancelledAt, deletedById: actorId },
      })
    await tx.invoice.updateMany({
      where: { inHouseWalletId: id, status: { in: ['PAID', 'PENDING'] } },
      data: { status: 'CANCELLED', cancelledAt },
    })
    return { id }
  })
}

export async function sellInHousePlan(
  input: {
    packageId: string
    userId: string
    paymentMethodId: string
    requestId: string
  },
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    const customer = await tx.user.findUnique({ where: { id: input.userId } })
    if (!customer) throw new NotFoundException('Customer tidak ditemukan.')
    await lockCustomerWallet(tx, input.userId)
    const previous = await tx.inHouseWallet.findFirst({
      where: { saleRequestId: input.requestId },
      include: { invoice: true },
    })
    if (previous) {
      if (
        previous.userId !== input.userId ||
        previous.packageId !== input.packageId
      )
        throw new BadRequestException('Referensi pembayaran telah dipakai.')
      if (previous.deletedAt)
        throw new BadRequestException(
          'Paket dari pembayaran ini sudah dibatalkan.',
        )
      return previous
    }
    await tx.$queryRaw`SELECT id FROM inhouse_plans WHERE id = ${input.packageId} FOR SHARE`
    const plan = await tx.inHousePlan.findFirst({
      where: { id: input.packageId, isActive: true },
      include: { staff: true },
    })
    if (!plan || !plan.staff.isActive || plan.staff.role !== 'COACH')
      throw new BadRequestException('Paket atau coach tidak aktif.')
    await tx.$queryRaw`SELECT id FROM payment_methods WHERE id = ${input.paymentMethodId} FOR SHARE`
    const method = await tx.paymentMethod.findFirst({
      where: {
        id: input.paymentMethodId,
        isActive: true,
        OR: [
          { isOffline: true },
          {
            channel: {
              in: ['CASH', 'EDC', 'QRIS_STATIC', 'BANK_TRANSFER_MANUAL'],
            },
          },
        ],
      },
    })
    if (!method)
      throw new BadRequestException(
        'Pilih metode pembayaran offline yang aktif.',
      )
    const wallet = await tx.inHouseWallet.create({
      data: {
        branchId: plan.branchId,
        packageId: plan.id,
        staffId: plan.staffId,
        userId: input.userId,
        saleRequestId: input.requestId,
        packageName: plan.name,
        totalMinutes: plan.hours * 60,
        remainingMinutes: plan.hours * 60,
        hourlyPrice: plan.hourlyPrice,
        courtHourlyShare: plan.courtHourlyShare,
        extraParticipantHourlyPrice: plan.extraParticipantHourlyPrice,
        createdById: actorId,
      },
    })
    const total = plan.hours * plan.hourlyPrice,
      now = new Date()
    const payment = await tx.payment.create({
      data: {
        paymentMethodId: method.id,
        status: 'PAID',
        amount: total,
        fees: 0,
        paidAt: now,
        meta: {
          source: 'INHOUSE_PACKAGE',
          receivedBy: actorId,
          receivedAt: now.toISOString(),
          methodName: method.name,
        },
      },
    })
    const invoice = await tx.invoice.create({
      data: {
        branchId: plan.branchId,
        userId: input.userId,
        inHouseWalletId: wallet.id,
        paymentId: payment.id,
        number: await generateInvoiceNumber(),
        subtotal: total,
        total,
        processingFee: 0,
        status: 'PAID',
        paidAt: now,
        dueDate: now,
      },
    })
    return { ...wallet, invoice }
  })
}

/** Called exclusively from admin checkout inside its transaction. Prices never come from the browser. */
export async function redeemInHouseSelections(
  tx: Tx,
  input: {
    selections: InHouseSelection[]
    userId: string
    bookingId: string
    courtSlotIds: string[]
    tariffRules?: TariffRule[]
    managementCustomer?: ManagementCustomer | null
    clubCoachSlots: { startAt: Date; endAt: Date }[]
  },
) {
  const { selections, userId, bookingId } = input
  if (
    new Set(selections.map((s) => s.courtSlotId)).size !== selections.length ||
    new Set(selections.map((s) => s.coachSlotId)).size !== selections.length
  )
    throw new BadRequestException(
      'Satu jam lapangan atau coach hanya dapat menggunakan satu paket.',
    )
  let coveredCourtAmount = 0,
    courtPriceAdjustment = 0,
    extraAmount = 0
  for (const id of [
    ...new Set(
      selections.flatMap((s) => ('walletId' in s ? [s.walletId] : [])),
    ),
  ].sort())
    await tx.$queryRaw`SELECT id FROM inhouse_wallets WHERE id = ${id} FOR UPDATE`
  // Reserve every coach slot together to enforce overlap checks across all selected coaches.
  await claimSlotsAtomically(tx, {
    slotIds: selections.map((s) => s.coachSlotId),
    type: 'COACH',
  })
  const coachType = await tx.bookingCoachType.findFirst({
    where: { name: INHOUSE_COACH_TYPE },
  })
  if (!coachType)
    throw new BadRequestException(
      'Jenis layanan in-house belum tersedia. Terapkan migrasi coaching in-house terlebih dahulu.',
    )
  const scheduleSelections = selections.filter((s) => 'staffId' in s)
  const scheduleSlots = scheduleSelections.length
    ? await tx.slot.findMany({
        where: {
          id: { in: scheduleSelections.map((s) => s.coachSlotId) },
          type: 'COACH',
          scheduleClosed: false,
          staff: { role: 'COACH', isActive: true, isInHouseCoach: true },
        },
        include: { staff: true },
      })
    : []
  for (const selection of selections) {
    const prepaid = 'walletId' in selection
    const scheduled = 'staffId' in selection
    const scheduleSlot = scheduled
      ? scheduleSlots.find(
          (slot) =>
            slot.id === selection.coachSlotId &&
            slot.staffId === selection.staffId,
        )
      : undefined
    if (!prepaid && !scheduled)
      await tx.$queryRaw`SELECT id FROM inhouse_plans WHERE id = ${selection.planId} FOR SHARE`
    const terms = scheduled
      ? scheduleSlot?.staff
        ? {
            id: scheduleSlot.id,
            staffId: scheduleSlot.staffId!,
            branchId: scheduleSlot.branchId,
            staff: scheduleSlot.staff,
            name: 'tarif Jadwal & Harga',
            hourlyPrice: scheduleSlot.price,
            courtHourlyShare: 0,
            extraParticipantHourlyPrice: 100000,
          }
        : null
      : prepaid
        ? await tx.inHouseWallet.findFirst({
            where: {
              id: selection.walletId,
              deletedAt: null,
              userId,
              invoice: { status: 'PAID' },
            },
            include: { staff: true },
          })
        : await tx.inHousePlan.findFirst({
            where: { id: selection.planId, hours: 1, isActive: true },
            include: { staff: true },
          })
    if (!terms || !terms.staff.isActive || terms.staff.role !== 'COACH')
      throw new BadRequestException(
        prepaid
          ? 'Kuota in-house tidak tersedia untuk customer ini.'
          : 'Tarif satuan atau coach in-house tidak tersedia.',
      )
    const court = await tx.bookingDetail.findFirst({
      where: { bookingId, slotId: selection.courtSlotId },
      include: { slot: { include: { court: true } } },
    })
    const coach = await tx.slot.findFirst({
      where: {
        id: selection.coachSlotId,
        staffId: terms.staffId,
        type: 'COACH',
        scheduleClosed: false,
      },
    })
    if (
      !input.courtSlotIds.includes(selection.courtSlotId) ||
      !court ||
      !coach ||
      court.slot.branchId !== terms.branchId ||
      coach.branchId !== terms.branchId ||
      +coach.startAt !== +court.slot.startAt ||
      +coach.endAt !== +court.slot.endAt ||
      +coach.endAt - +coach.startAt !== 3600000
    )
      throw new BadRequestException(
        'Paket harus sesuai coach, cabang dan satu jam lapangan yang dipilih.',
      )
    assertCoachingSport(
      'COACH',
      terms.staff.coachType,
      court.slot.court?.sport ?? 'PADEL',
    )
    if (
      input.clubCoachSlots.some(
        (s) => s.startAt < coach.endAt && s.endAt > coach.startAt,
      )
    )
      throw new BadRequestException(
        'Paket in-house dan coach club tidak dapat dipakai pada jam yang sama.',
      )
    if (prepaid) {
      const debit = await tx.inHouseWallet.updateMany({
        where: { id: terms.id, userId, remainingMinutes: { gte: 60 } },
        data: { remainingMinutes: { decrement: 60 } },
      })
      if (debit.count !== 1)
        throw new BadRequestException(
          'Sisa kuota coaching tidak cukup. Muat ulang pilihan paket.',
        )
    }
    const managementRate = prepaid
      ? null
      : managementInHouseRate(
          input.managementCustomer,
          court.slot.startAt,
          resolveTariffPeriod(
            input.tariffRules ?? [],
            court.slot.startAt,
            court.slot.branchId,
            court.slot.court?.sport ?? 'PADEL',
          ),
        )
    const price = priceInHouseHour(
      managementRate
        ? { ...terms, hourlyPrice: managementRate.coach, courtHourlyShare: 0 }
        : terms,
      selection.participants,
    )
    // Tariff discounts apply only to direct hourly coaching; prepaid terms stay frozen.
    const discount = prepaid
      ? null
      : scheduled
        ? 0
        : getInHouseCourtDiscount(court.slot, input.tariffRules)
    const fixedCourtPrice = prepaid
      ? null
      : (managementRate?.court ??
        getInHouseCourtHourlyPrice(court.slot, input.tariffRules))
    const courtDue =
      fixedCourtPrice ??
      (discount === null ? 0 : Math.max(0, court.discountPrice - discount))
    const courtLinePrice =
      fixedCourtPrice ??
      (discount === null
        ? price.courtAmount
        : Math.max(0, court.discountPrice - discount))
    const coachDue = prepaid
      ? 0
      : fixedCourtPrice !== null
        ? price.coachAmount
        : discount === null
          ? terms.hourlyPrice
          : price.coachAmount
    await tx.bookingCoach.create({
      data: {
        bookingId,
        slotId: coach.id,
        courtSlotId: court.slotId,
        bookingCoachTypeId: coachType.id,
        price: price.extraAmount + (prepaid ? 0 : price.coachAmount),
        description: `${managementRate ? 'Management · ' : ''}In-house ${prepaid ? ('packageName' in terms ? terms.packageName : '') : `satuan ${'name' in terms ? terms.name : '1 jam'}`}; ${selection.participants} peserta`,
        ...(prepaid
          ? {
              inHouseUsage: {
                create: {
                  branchId: terms.branchId,
                  walletId: terms.id,
                  minutes: 60,
                  participants: selection.participants,
                  ...price,
                },
              },
            }
          : {}),
      },
    })
    await tx.bookingDetail.update({
      where: { id: court.id },
      data: { discountPrice: courtLinePrice },
    })
    coveredCourtAmount += court.discountPrice - courtDue
    courtPriceAdjustment += court.discountPrice - courtLinePrice
    extraAmount += price.extraAmount + coachDue
  }
  return { coveredCourtAmount, courtPriceAdjustment, extraAmount }
}

/** Atomic restore guard makes retries and repeated cancellation paths harmless. */
export async function restoreInHouseUsage(
  tx: Tx,
  usageId: string,
  now = new Date(),
) {
  const usage = await tx.inHouseUsage.findFirst({ where: { id: usageId } })
  if (!usage) return
  const changed = await tx.inHouseUsage.updateMany({
    where: { id: usageId, restoredAt: null },
    data: { restoredAt: now },
  })
  if (changed.count === 1)
    await tx.inHouseWallet.update({
      where: { id: usage.walletId },
      data: { remainingMinutes: { increment: usage.minutes } },
    })
}

export async function listInHouseUsage(userId?: string) {
  const rows = await db.inHouseUsage.findMany({
    where: userId ? { wallet: { userId } } : {},
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      wallet: {
        include: {
          user: { select: { name: true } },
          staff: { select: { name: true } },
        },
      },
      bookingCoach: {
        include: {
          slot: true,
          booking: {
            include: { invoice: { select: { id: true, number: true } } },
          },
        },
      },
    },
  })
  return rows.map((row) => ({
    ...row,
    startAt: formatClubWallClock(row.bookingCoach.slot.startAt),
    endAt: formatClubWallClock(row.bookingCoach.slot.endAt),
  }))
}
