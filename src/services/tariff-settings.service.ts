import { db } from '@/lib/prisma'
import dayjs, { toClubWallDate } from '@/lib/club-time'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@/exceptions'
import { branchContext } from '@/lib/branch-context'
import { assertCourtSportAtBranch } from '@/lib/court-branch-policy'
import {
  resolveTariffPeriod,
  tariffPeriodSchema,
  type TariffPeriodInput,
} from '@/lib/tariff-period'
import { getTariffPeriods } from './tariff-policy.service'
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
    await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR NO KEY UPDATE`
    const effectiveFrom = toClubWallDate(`${data.effectiveFrom} 00:00:00`)
    const previous = resolveTariffPeriod(
      await getTariffPeriods(tx, branchId),
      effectiveFrom,
      branchId,
      data.sport,
      false,
    )
    const inHouseDiscounts = {
      managementCourtHourlyPrice:
        data.managementCourtHourlyPrice === undefined
          ? previous.managementCourtHourlyPrice
          : data.managementCourtHourlyPrice,
      managementCoachHourlyPrice:
        data.managementCoachHourlyPrice === undefined
          ? previous.managementCoachHourlyPrice
          : data.managementCoachHourlyPrice,
      inHouseCourtHourlyPrice:
        data.inHouseCourtHourlyPrice === undefined
          ? (previous.inHouseCourtHourlyPrice ?? null)
          : data.inHouseCourtHourlyPrice,
      happyInHouseCoachDiscount:
        data.happyInHouseCoachDiscount === undefined
          ? (previous.happyInHouseCoachDiscount ?? null)
          : data.happyInHouseCoachDiscount,
      peakInHouseCoachDiscount:
        data.peakInHouseCoachDiscount === undefined
          ? (previous.peakInHouseCoachDiscount ?? null)
          : data.peakInHouseCoachDiscount,
    }
    const happyAllDayDays =
      data.happyAllDayDays ?? previous.happyAllDayDays ?? []
    const daysChanged =
      JSON.stringify([...happyAllDayDays].sort()) !==
      JSON.stringify([...(previous.happyAllDayDays ?? [])].sort())
    const hoursChanged = (
      ['happyStart', 'happyEnd', 'peakStart', 'peakEnd'] as const
    ).some((field) => previous[field] !== data[field])
    const rule = await tx.tariffPeriod.upsert({
      where: {
        branchId_sport_effectiveFrom: {
          branchId,
          sport: data.sport,
          effectiveFrom,
        },
      },
      create: {
        ...data,
        ...inHouseDiscounts,
        happyAllDayDays,
        effectiveFrom,
        branchId,
      },
      update: {
        happyAllDayDays,
        happyStart: data.happyStart,
        happyEnd: data.happyEnd,
        peakStart: data.peakStart,
        peakEnd: data.peakEnd,
        ...inHouseDiscounts,
        happyCoachDiscount: data.happyCoachDiscount,
        peakCoachDiscount: data.peakCoachDiscount,
      },
    })
    if (hoursChanged || daysChanged)
      await refreshTariffCourtSchedules(
        tx,
        branchId,
        data.sport,
        effectiveFrom,
        now,
      )
    return rule
  })
}
