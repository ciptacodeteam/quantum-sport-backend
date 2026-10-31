import { db } from '@/lib/prisma'
import dayjs from '@/lib/club-time'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@/exceptions'
import { branchContext } from '@/lib/branch-context'
import { assertCourtSportAtBranch } from '@/lib/court-branch-policy'
import { tariffPeriodSchema, type TariffPeriodInput } from '@/lib/tariff-period'
import { refreshTariffCourtSchedules } from './rolling-court-schedule.service'

export async function saveTariffPeriod(
  branchId: string,
  input: TariffPeriodInput,
  now = new Date(),
) {
  const context = branchContext.getStore()
  if (context?.branchId && context.branchId !== branchId)
    throw new ForbiddenException('Cabang tidak sesuai.')
  const data = tariffPeriodSchema.parse(input)
  assertCourtSportAtBranch(data.sport, branchId)
  if (data.effectiveFrom < dayjs(now).format('YYYY-MM-DD'))
    throw new BadRequestException(
      'Aturan baru tidak boleh berlaku sebelum hari ini.',
    )
  return db.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, isActive: true },
    })
    if (!branch) throw new NotFoundException('Cabang tidak ditemukan.')
    await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR UPDATE`
    const effectiveFrom = new Date(`${data.effectiveFrom}T00:00:00Z`)
    const rule = await tx.tariffPeriod.upsert({
      where: {
        branchId_sport_effectiveFrom: {
          branchId,
          sport: data.sport,
          effectiveFrom,
        },
      },
      create: { ...data, effectiveFrom, branchId },
      update: {
        happyStart: data.happyStart,
        happyEnd: data.happyEnd,
        peakStart: data.peakStart,
        peakEnd: data.peakEnd,
      },
    })
    await refreshTariffCourtSchedules(
      tx,
      branchId,
      data.sport,
      dayjs(data.effectiveFrom).startOf('day').toDate(),
      now,
    )
    return rule
  })
}
