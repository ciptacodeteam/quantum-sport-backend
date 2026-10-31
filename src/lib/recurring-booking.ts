import { z } from 'zod'
import dayjs from '@/lib/club-time'

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      dayjs(value).isValid() && dayjs(value).format('YYYY-MM-DD') === value,
  )
export const recurringBookingInputSchema = z
  .object({
    mode: z.enum(['ROLLING', 'MONTHS', 'DATES']),
    endDate: dateKey.optional(),
    skipConflicts: z.boolean().optional(),
    months: z.number().int().min(1).max(12).optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startDate: dateKey,
    previewThrough: dateKey,
    sourceSlotIds: z.array(z.string().min(1)).min(1).max(36),
  })
  .refine((value) => value.mode !== 'MONTHS' || value.months !== undefined, {
    message: 'Pilih durasi bulan.',
  })
  .refine(
    (value) =>
      value.mode !== 'DATES' ||
      (!!value.endDate &&
        value.endDate >= value.startDate &&
        value.endDate <=
          dayjs(value.startDate).add(12, 'month').format('YYYY-MM-DD')),
    { message: 'Pilih rentang tanggal yang valid, maksimal 12 bulan.' },
  )
export type RecurringBookingInput = z.infer<typeof recurringBookingInputSchema>
export const recurringTemplatesSchema = z
  .array(
    z.object({
      courtId: z.string(),
      courtName: z.string(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      durationMinutes: z.number().int().positive(),
    }),
  )
  .min(1)
export type RecurringTemplate = z.infer<typeof recurringTemplatesSchema>[number]
// SQL DATE values must stay date-only, independent of the process timezone.
export const dateOnly = (key: string) => new Date(`${key}T00:00:00.000Z`)
export const dateOnlyKey = (date: Date) => date.toISOString().slice(0, 10)
export function matchingDates(start: string, end: string, weekdays: number[]) {
  const result: string[] = []
  for (
    let date = dayjs(start);
    !date.isAfter(dayjs(end), 'day');
    date = date.add(1, 'day')
  ) {
    if (weekdays.includes(date.day())) result.push(date.format('YYYY-MM-DD'))
  }
  return result
}
