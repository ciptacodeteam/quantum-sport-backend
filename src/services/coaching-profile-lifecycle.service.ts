import type { Prisma } from '@prisma/client'
import { db } from '@/lib/prisma'
import { BadRequestException, NotFoundException } from '@/exceptions'

// Count all historical references, including cancelled orders and sold packages.
export const coachingHistorySelect = {
  slot: {
    where: {
      OR: [
        { bookingCoaches: { some: {} } },
        { bookingBallboys: { some: {} } },
        { bookingDetails: { some: {} } },
        { bookingInventories: { some: {} } },
        { courtCoaches: { some: {} } },
        { courtBallboys: { some: {} } },
      ],
    },
  },
  inHouseWallets: true,
  inHousePlans: { where: { wallets: { some: {} } } },
  bookingCashier: true,
} satisfies Prisma.StaffCountOutputTypeSelect

export function canDeleteCoachingProfile(counts: {
  slot: number
  inHouseWallets: number
  inHousePlans: number
  bookingCashier: number
}) {
  return Object.values(counts).every((value) => value === 0)
}

async function lockedCoach(tx: Prisma.TransactionClient, id: string) {
  const coach = await tx.staff.findFirst({
    where: { id, role: 'COACH' },
    select: { id: true },
  })
  if (!coach)
    throw new NotFoundException('Coach tidak ditemukan di cabang ini.')
  await tx.$queryRaw`SELECT id FROM staff WHERE id = ${id} FOR UPDATE`
  const current = await tx.staff.findFirst({
    where: { id, role: 'COACH' },
    select: { id: true, _count: { select: coachingHistorySelect } },
  })
  if (!current)
    throw new NotFoundException('Coach tidak ditemukan di cabang ini.')
  return current
}

export async function setCoachingProfileActive(id: string, isActive: boolean) {
  return db.$transaction(async (tx) => {
    await lockedCoach(tx, id)
    return tx.staff.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true },
    })
  })
}

export async function deleteUnusedCoachingProfile(id: string) {
  try {
    return await db.$transaction(async (tx) => {
      const coach = await lockedCoach(tx, id)
      if (!canDeleteCoachingProfile(coach._count))
        throw new BadRequestException(
          'Coach sudah memiliki riwayat pemesanan atau paket pelanggan. Nonaktifkan profil untuk menghentikan pemesanan baru.',
        )
      await tx.coachingGroupCoach.deleteMany({ where: { staffId: id } })
      await tx.coachTypeStaffPrice.deleteMany({ where: { staffId: id } })
      await tx.inHousePlan.deleteMany({ where: { staffId: id } })
      await tx.slot.deleteMany({ where: { staffId: id } })
      await tx.staff.delete({ where: { id } })
      return { id }
    })
  } catch (error) {
    // A concurrent booking/sale can acquire an FK reference after the count.
    // The entire transaction rolls back, keeping every profile and order intact.
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2003'
    )
      throw new BadRequestException(
        'Coach masih terhubung ke data pemesanan atau paket pelanggan dan tidak dapat dihapus. Muat ulang daftar coach.',
      )
    throw error
  }
}
