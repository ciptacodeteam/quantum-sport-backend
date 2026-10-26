import dayjs, { type ConfigType } from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { JAKARTA_TZ } from '@/config'

dayjs.extend(utc)
dayjs.extend(timezone)

/** Date-only/local inputs are club wall time; Date objects and offset inputs are instants. */
export default function clubTime(value?: ConfigType) {
  const parsed = dayjs(value)
  if (!parsed.isValid()) return parsed
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    return dayjs.tz(value, JAKARTA_TZ)
  }
  return parsed.tz(JAKARTA_TZ)
}
