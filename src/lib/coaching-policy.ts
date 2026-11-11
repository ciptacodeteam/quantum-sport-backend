import { BadRequestException } from '@/exceptions'
import { toClubWallDate } from './club-time'
import { courtBookingCutoff } from './booking-time-policy'
import dayjs from 'dayjs'
import { z } from 'zod'

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => dayjs.utc(v).format('YYYY-MM-DD') === v,
    'Tanggal tidak valid.',
  )
export const coachingProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['COACH', 'BALLBOY']),
    coachType: z.enum(['PADEL', 'TENNIS', 'PADEL_TENNIS']).optional(),
    phone: z.string().trim().min(8).max(20).optional(),
    groupIds: z
      .array(z.string().min(1))
      .max(100)
      .refine((v) => new Set(v).size === v.length)
      .optional(),
    coachProfile: z.string().trim().max(2000).optional(),
    isInHouseCoach: z.boolean().optional(),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.kind !== 'COACH' || !!v.coachType, 'Pilih olahraga coach.')
  .refine(
    (v) => !v.isInHouseCoach || v.kind === 'COACH',
    'Hanya coach yang dapat menjadi coach in-house.',
  )
export const coachingScheduleSchema = z
  .object({
    fromDate: date,
    toDate: date,
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    price: z.number().int().min(0).max(2147483647),
  })
  .strict()
  .refine(
    (v) => v.endHour > v.startHour,
    'Jam selesai harus setelah jam mulai.',
  )
  .refine(
    (v) =>
      dayjs.utc(v.toDate).diff(dayjs.utc(v.fromDate), 'day') >= 0 &&
      dayjs.utc(v.toDate).diff(dayjs.utc(v.fromDate), 'day') <= 365,
    'Periode maksimal 366 hari.',
  )

export function buildCoachingSlots(
  input: z.infer<typeof coachingScheduleSchema>,
  now = new Date(),
) {
  const result: { startAt: Date; endAt: Date; price: number }[] = []
  for (
    let day = dayjs.utc(input.fromDate);
    !day.isAfter(dayjs.utc(input.toDate), 'day');
    day = day.add(1, 'day')
  ) {
    if (!input.days.includes(day.day() || 7)) continue
    for (let hour = input.startHour; hour < input.endHour; hour++) {
      const startAt = toClubWallDate(
        `${day.format('YYYY-MM-DD')} ${String(hour).padStart(2, '0')}:00:00`,
      )
      if (startAt <= courtBookingCutoff(now)) continue
      result.push({
        startAt,
        endAt: new Date(+startAt + 3_600_000),
        price: input.price,
      })
    }
  }
  return result
}

export function assertCoachingSport(
  kind: string,
  coachType: string | null,
  sport: string,
) {
  if (kind === 'BALLBOY') return
  const effectiveType = coachType
  if (effectiveType !== sport && effectiveType !== 'PADEL_TENNIS')
    throw new BadRequestException(
      `Olahraga ${kind === 'BALLBOY' ? 'ballboy' : 'coach'} tidak sesuai dengan lapangan.`,
    )
}

/** Repeating service hours; dates come exclusively from rolling court slots. */
export const rollingCoachingScheduleSchema = z
  .object({
    followCourtWindow: z.literal(true),
    additionalHourPrice: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .nullable()
      .optional(),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    price: z.number().int().min(0).max(2147483647),
  })
  .strict()
  .refine(
    (v) => v.endHour > v.startHour,
    'Jam selesai harus setelah jam mulai.',
  )

export function buildRollingCoachingSlots(
  config: z.infer<typeof rollingCoachingScheduleSchema>,
  courtSlots: { startAt: Date; endAt: Date }[],
  now = new Date(),
) {
  const unique = new Map<
    string,
    { startAt: Date; endAt: Date; price: number }
  >()
  for (const slot of courtSlots) {
    const wall = dayjs.utc(slot.startAt)
    if (
      slot.startAt <= courtBookingCutoff(now) ||
      !config.days.includes(wall.day() || 7) ||
      wall.hour() < config.startHour ||
      wall.hour() >= config.endHour ||
      wall.minute() !== 0 ||
      +slot.endAt - +slot.startAt !== 3_600_000
    )
      continue
    unique.set(slot.startAt.toISOString(), { ...slot, price: config.price })
  }
  return [...unique.values()]
}
