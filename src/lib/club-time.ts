import dayjs, { type ConfigType, type Dayjs } from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { JAKARTA_TZ } from '@/config'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * Slot `startAt`/`endAt` are stored as Asia/Jakarta wall clock in
 * `timestamp without time zone`. Prisma/Node on a UTC host expose those walls
 * as UTC components (e.g. DB `19:00` → `Date` 19:00Z). Do not shift them again.
 */
export function clubWallTime(value: ConfigType): Dayjs {
  if (value instanceof Date) {
    return dayjs.tz(
      dayjs.utc(value).format('YYYY-MM-DD HH:mm:ss.SSS'),
      JAKARTA_TZ,
    )
  }
  if (typeof value === 'string') {
    if (/Z$/i.test(value)) {
      return dayjs.tz(
        dayjs.utc(value).format('YYYY-MM-DD HH:mm:ss.SSS'),
        JAKARTA_TZ,
      )
    }
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
      return dayjs.tz(value, JAKARTA_TZ)
    }
  }
  return dayjs(value).tz(JAKARTA_TZ)
}

export function formatClubWallClock(
  value: ConfigType,
  format = 'YYYY-MM-DD HH:mm:ss',
) {
  return clubWallTime(value).format(format)
}

/** Calendar date (YYYY-MM-DD) of a wall-stored slot or query bound. */
export function clubWallDateString(value: ConfigType): string {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
    if (match) return match[1]
  }
  if (value instanceof Date) {
    return dayjs.utc(value).format('YYYY-MM-DD')
  }
  return clubWallTime(value).format('YYYY-MM-DD')
}

/**
 * Convert a wall-clock value to a `Date` whose UTC components match the wall
 * (for comparing against Prisma-read `timestamp without time zone` slots).
 */
export function toClubWallDate(value: ConfigType): Date {
  if (value instanceof Date) {
    return new Date(value.getTime())
  }
  if (typeof value === 'string') {
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i,
    )
    if (match) {
      const ms = (match[7] ?? '0').padEnd(3, '0').slice(0, 3)
      return new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4] ?? 0),
          Number(match[5] ?? 0),
          Number(match[6] ?? 0),
          Number(ms),
        ),
      )
    }
  }
  const wall = clubWallTime(value)
  return new Date(
    Date.UTC(
      wall.year(),
      wall.month(),
      wall.date(),
      wall.hour(),
      wall.minute(),
      wall.second(),
      wall.millisecond(),
    ),
  )
}

/** Inclusive start of a club calendar day for Prisma slot filters. */
export function clubWallDayStart(value: ConfigType): Date {
  return new Date(`${clubWallDateString(value)}T00:00:00.000Z`)
}

/** Inclusive end of a club calendar day for Prisma slot filters. */
export function clubWallDayEnd(value: ConfigType): Date {
  return new Date(`${clubWallDateString(value)}T23:59:59.999Z`)
}

/** Exclusive end (next wall midnight) for `startAt: { lt }` windows. */
export function clubWallNextDayStart(value: ConfigType): Date {
  return dayjs
    .utc(`${clubWallDateString(value)}T00:00:00.000Z`)
    .add(1, 'day')
    .toDate()
}

/** True instants (createdAt, now, offset strings) → Asia/Jakarta display. */
export default function clubTime(value?: ConfigType) {
  const parsed = dayjs(value)
  if (!parsed.isValid()) return parsed
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    return dayjs.tz(value, JAKARTA_TZ)
  }
  return parsed.tz(JAKARTA_TZ)
}

/**
 * Current club wall clock as a UTC-component `Date`, for comparing against
 * wall-stored slot timestamps.
 */
export function clubNowAsWallDate(now: ConfigType = new Date()): Date {
  const jakarta = clubTime(now)
  return new Date(
    Date.UTC(
      jakarta.year(),
      jakarta.month(),
      jakarta.date(),
      jakarta.hour(),
      jakarta.minute(),
      jakarta.second(),
      jakarta.millisecond(),
    ),
  )
}
