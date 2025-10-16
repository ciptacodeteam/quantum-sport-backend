import { DayToken } from '@/types'
import dayjs from 'dayjs'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'

dayjs.extend(isSameOrBefore)

const DAY_MAP: Record<string, number> = {
  // EN long
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  // EN short
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
  // ID long
  minggu: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  sabtu: 6,
}

export function toDayNums(days?: DayToken[]) {
  if (!days || !days.length) return null
  return new Set(
    days
      .map((d) =>
        typeof d === 'number' ? d : DAY_MAP[String(d).toLowerCase().trim()],
      )
      .filter((n): n is number => n >= 0 && n <= 6),
  )
}

export function getScheduleFromDateRange(
  fromDate: string, // '2025-01-01'
  toDate: string, // '2025-01-02'
  fromTime: string, // '08:00:00' or '08:00'
  toTime: string, // '15:00:00' or '15:00'
  days?: DayToken[], // e.g., ['Sunday', ...] or ['Senin', ...]
  intervalMinutes = 60,
) {
  const start = dayjs(fromDate, 'YYYY-MM-DD', true)
  const end = dayjs(toDate, 'YYYY-MM-DD', true)
  if (!start.isValid() || !end.isValid()) throw new Error('Invalid dates')
  if (end.isBefore(start, 'day'))
    throw new Error('toDate must be after fromDate')

  const allowed = toDayNums(days)
  const schedules: Array<{ date: string; time: string }> = []

  // accept either HH:mm or HH:mm:ss
  const timeFmt =
    fromTime.length === 8 || toTime.length === 8 ? 'HH:mm:ss' : 'HH:mm'

  for (let d = start; d.isSameOrBefore(end, 'day'); d = d.add(1, 'day')) {
    if (allowed && !allowed.has(d.day())) continue

    const base = d.format('YYYY-MM-DD')
    const startTime = dayjs(
      `${base} ${fromTime}`,
      `YYYY-MM-DD ${timeFmt}`,
      true,
    )
    const endTime = dayjs(`${base} ${toTime}`, `YYYY-MM-DD ${timeFmt}`, true)
    if (!startTime.isValid() || !endTime.isValid()) continue
    if (endTime.isBefore(startTime)) continue // change if you want overnight support

    for (
      let t = startTime;
      t.isSameOrBefore(endTime);
      t = t.add(intervalMinutes, 'minute')
    ) {
      schedules.push({ date: base, time: t.format('HH:mm') })
    }
  }
  return schedules
}
