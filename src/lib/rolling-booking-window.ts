import { z } from 'zod'
import dayjs, {
  clubNowAsWallDate,
  clubWallDayEnd,
  clubWallTime,
  toClubWallDate,
} from '@/lib/club-time'
import type { Prisma } from '@prisma/client'
import {
  resolveTariffPeriod,
  tariffBand,
  type TariffRule,
} from '@/lib/tariff-period'
import {
  rollingSlotRuleSchema,
  matchesRollingSlotRule,
} from '@/lib/rolling-slot-rule'

export const rollingCourtPricingSchema = z
  .object({
    courtId: z.string().min(1),
    months: z.number().int().min(1).max(12),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    happyHourPrice: z.number().int().min(0).max(2147483647),
    happyHourDiscountPrice: z.number().int().min(0).max(2147483647).default(0),
    peakHourPrice: z.number().int().min(0).max(2147483647),
    peakHourDiscountPrice: z.number().int().min(0).max(2147483647).default(0),
    closedHours: z.array(z.number().int().min(0).max(23)).max(24).default([]),
    bulkRules: z.array(rollingSlotRuleSchema).optional(),
  })
  .superRefine((value, ctx) => {
    for (const band of ['happyHour', 'peakHour'] as const) {
      if (value[`${band}DiscountPrice`] > value[`${band}Price`]) {
        ctx.addIssue({
          code: 'custom',
          path: [`${band}DiscountPrice`],
          message: 'Harga diskon tidak boleh melebihi harga normal.',
        })
      }
    }
  })
export type RollingCourtPricing = z.infer<typeof rollingCourtPricingSchema>

export function bookingWindowEnd(months: number, now = new Date()) {
  const endDay = dayjs(now)
    .startOf('day')
    .add(months, 'month')
    .format('YYYY-MM-DD')
  return clubWallDayEnd(endDay)
}

/** Enforce the horizon inside the same UPDATE that claims a slot. */
export function rollingBookingWindowWhere(
  now = new Date(),
): Prisma.SlotWhereInput {
  return {
    scheduleClosed: false,
    OR: [
      { court: { is: { bookingWindowMonths: null } } },
      ...Array.from({ length: 12 }, (_, i) => ({
        court: { is: { bookingWindowMonths: i + 1 } },
        startAt: { lte: bookingWindowEnd(i + 1, now) },
      })),
    ],
  }
}

export function buildRollingCourtSlots(
  config: RollingCourtPricing & { sport?: string },
  branchId: string,
  from: Date,
  now = new Date(),
  tariffRules: TariffRule[] = [],
  through?: Date,
) {
  const end = clubWallTime(through ?? bookingWindowEnd(config.months, now))
  const nowWall = clubNowAsWallDate(now)
  const slots: (Prisma.SlotCreateManyInput & { startAt: Date; endAt: Date })[] =
    []
  for (
    let date = dayjs(from).startOf('day');
    !date.isAfter(end, 'day');
    date = date.add(1, 'day')
  ) {
    if (!config.days.includes(date.day() || 7)) continue
    const dayKey = date.format('YYYY-MM-DD')
    const bands = resolveTariffPeriod(
      tariffRules,
      toClubWallDate(`${dayKey} 00:00:00`),
      branchId,
      config.sport ?? 'PADEL',
    )
    for (let hour = 0; hour < 24; hour++) {
      if (config.closedHours.includes(hour)) continue
      const startAt = toClubWallDate(
        `${dayKey} ${String(hour).padStart(2, '0')}:00:00`,
      )
      const endAt = new Date(startAt.getTime() + 3_600_000)
      const band = tariffBand(startAt, bands, endAt)
      if (!band) continue
      if (!(startAt > nowWall)) continue
      const priceRule = config.bulkRules?.findLast(
        (rule) =>
          rule.kind === 'pricing' && matchesRollingSlotRule(startAt, rule),
      )
      slots.push({
        branchId,
        courtId: config.courtId,
        type: 'COURT',
        startAt,
        endAt,
        price:
          priceRule?.kind === 'pricing'
            ? priceRule.price
            : band === 'happyHour'
              ? config.happyHourPrice
              : config.peakHourPrice,
        discountPrice:
          priceRule?.kind === 'pricing'
            ? priceRule.discountPrice
            : band === 'happyHour'
              ? config.happyHourDiscountPrice
              : config.peakHourDiscountPrice,
        isAvailable: true,
      })
    }
  }
  return slots
}
