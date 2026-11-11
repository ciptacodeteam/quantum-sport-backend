import { z } from 'zod'
import dayjs, { clubWallTime } from '@/lib/club-time'

export const defaultTariffPeriod = {
  happyStart: 6,
  happyEnd: 15,
  peakStart: 15,
  peakEnd: 24,
}
export type TariffBands = typeof defaultTariffPeriod
export type CoachingDiscounts = {
  inHouseCourtHourlyPrice?: number | null
  happyInHouseCoachDiscount?: number | null
  peakInHouseCoachDiscount?: number | null
  happyCoachDiscount?: number
  peakCoachDiscount?: number
}
export type TariffDays = { happyAllDayDays?: number[] }
export type TariffRule = TariffBands &
  TariffDays &
  CoachingDiscounts & {
    branchId: string
    sport: string
    effectiveFrom: Date | string
  }
export const tariffPeriodSchema = z
  .object({
    sport: z.enum(['PADEL', 'TENNIS']),
    happyAllDayDays: z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .refine(
        (days) => new Set(days).size === days.length,
        'Hari tidak boleh berulang.',
      )
      .optional(),
    effectiveFrom: z
      .string()
      .refine(
        (value) =>
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          dayjs(value).format('YYYY-MM-DD') === value,
        'Tanggal tidak valid.',
      ),
    happyStart: z.number().int().min(0).max(23),
    happyEnd: z.number().int().min(1).max(24),
    peakStart: z.number().int().min(0).max(23),
    peakEnd: z.number().int().min(1).max(24),
    inHouseCourtHourlyPrice: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .nullable()
      .optional(),
    happyInHouseCoachDiscount: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .nullable()
      .optional(),
    peakInHouseCoachDiscount: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .nullable()
      .optional(),
    happyCoachDiscount: z.number().int().min(0).max(2147483647).optional(),
    peakCoachDiscount: z.number().int().min(0).max(2147483647).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.happyInHouseCoachDiscount != null) !==
      (value.peakInHouseCoachDiscount != null)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['happyInHouseCoachDiscount'],
        message: 'Isi kedua potongan in-house atau nonaktifkan keduanya.',
      })
    if (value.happyEnd <= value.happyStart)
      ctx.addIssue({
        code: 'custom',
        path: ['happyEnd'],
        message: 'Jam selesai harus setelah jam mulai.',
      })
    if (value.peakEnd <= value.peakStart)
      ctx.addIssue({
        code: 'custom',
        path: ['peakEnd'],
        message: 'Jam selesai harus setelah jam mulai.',
      })
    if (
      value.happyEnd !== value.peakStart &&
      value.peakEnd !== value.happyStart
    )
      ctx.addIssue({
        code: 'custom',
        path: ['peakStart'],
        message:
          'Rentang Happy Hour dan Peak Hour harus bersebelahan, tanpa tumpang tindih atau jeda.',
      })
  })
export type TariffPeriodInput = z.infer<typeof tariffPeriodSchema>
const dateKey = (value: Date | string) =>
  typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10)

export function resolveTariffPeriod(
  rules: TariffRule[],
  startAt: Date | string,
  branchId: string,
  sport: string,
  applyDay = true,
): TariffBands & CoachingDiscounts & TariffDays {
  const date = clubWallTime(startAt).format('YYYY-MM-DD')
  const rule =
    rules
      .filter(
        (rule) =>
          rule.branchId === branchId &&
          rule.sport === sport &&
          dateKey(rule.effectiveFrom) <= date,
      )
      .sort((a, b) =>
        dateKey(b.effectiveFrom).localeCompare(dateKey(a.effectiveFrom)),
      )[0] ?? defaultTariffPeriod
  if (
    applyDay &&
    'happyAllDayDays' in rule &&
    (rule.happyAllDayDays as number[] | undefined)?.includes(
      clubWallTime(startAt).day() || 7,
    )
  ) {
    const end = Math.max(rule.happyEnd, rule.peakEnd)
    return {
      ...rule,
      happyStart: Math.min(rule.happyStart, rule.peakStart),
      happyEnd: end,
      peakStart: end,
      peakEnd: end,
    }
  }
  return rule
}
export function tariffBand(
  startAt: Date | string,
  bands: TariffBands,
  endAt?: Date | string,
): 'happyHour' | 'peakHour' | null {
  const start = clubWallTime(startAt)
  const minutes = start.hour() * 60 + start.minute()
  const duration = endAt ? clubWallTime(endAt).diff(start, 'minute', true) : 0
  for (const band of ['happy', 'peak'] as const) {
    if (
      minutes >= bands[`${band}Start`] * 60 &&
      minutes < bands[`${band}End`] * 60 &&
      duration >= 0 &&
      minutes + duration <= bands[`${band}End`] * 60
    )
      return band === 'happy' ? 'happyHour' : 'peakHour'
  }
  return null
}
