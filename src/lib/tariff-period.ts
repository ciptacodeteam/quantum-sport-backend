import { z } from 'zod'
import dayjs from '@/lib/club-time'

export const defaultTariffPeriod = {
  happyStart: 6,
  happyEnd: 15,
  peakStart: 15,
  peakEnd: 24,
}
export type TariffBands = typeof defaultTariffPeriod
export type TariffRule = TariffBands & {
  branchId: string
  sport: string
  effectiveFrom: Date | string
}
export const tariffPeriodSchema = z
  .object({
    sport: z.enum(['PADEL', 'TENNIS']),
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
  })
  .superRefine((value, ctx) => {
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
): TariffBands {
  const date = dayjs(startAt).format('YYYY-MM-DD')
  return (
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
  )
}
export function tariffBand(
  startAt: Date | string,
  bands: TariffBands,
  endAt?: Date | string,
): 'happyHour' | 'peakHour' | null {
  const start = dayjs(startAt)
  const minutes = start.hour() * 60 + start.minute()
  const duration = endAt ? dayjs(endAt).diff(start, 'minute', true) : 0
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
