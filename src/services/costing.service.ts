import { JAKARTA_TZ } from '@/config'
import { log } from '@/lib/logger'
import { db } from '@/lib/prisma'
import dayjs from 'dayjs'
import { SlotType } from '@prisma/client'

type SetCourtPricingPayload = {
  courtId: string
  fromDate: string // YYYY-MM-DD
  toDate: string // YYYY-MM-DD
  days: number[] // 1=Mon, 2=Tue, ..., 7=Sun
  happyHourPrice: number
  peakHourPrice: number
  closedHours?: number[]
}

const HAPPY_START = 6
const HAPPY_END = 15 // exclusive
const PEAK_START = 15
const PEAK_END = 24 // exclusive

function hoursForBand(start: number, end: number) {
  return Array.from({ length: end - start }, (_, i) => start + i)
}

function toUtcRange(dateISO: string, hour: number) {
  const startAt = dayjs
    .tz(dateISO, JAKARTA_TZ)
    .hour(hour)
    .minute(0)
    .second(0)
    .millisecond(0)
  const next =
    hour + 1 === 24
      ? dayjs.tz(dateISO, JAKARTA_TZ).add(1, 'day').hour(0)
      : dayjs.tz(dateISO, JAKARTA_TZ).hour(hour + 1)
  const endAt = next.minute(0).second(0).millisecond(0)
  return { startAt: startAt.toDate(), endAt: endAt.toDate() }
}

function dayNumber(d: dayjs.Dayjs): number {
  const jsDay = d.day() // 0 = Sunday, 6 = Saturday
  return jsDay === 0 ? 7 : jsDay // convert 0→7, so Monday=1..Sunday=7
}

export async function setCourtPricing({
  courtId,
  fromDate,
  toDate,
  days,
  happyHourPrice,
  peakHourPrice,
  closedHours = [0, 1, 2, 3, 4, 5],
}: SetCourtPricingPayload) {
  try {
    const start = dayjs(fromDate)
    const end = dayjs(toDate)

    for (
      let d = start;
      d.isBefore(end) || d.isSame(end, 'day');
      d = d.add(1, 'day')
    ) {
      const dayNum = dayNumber(d)
      if (!days.includes(dayNum)) continue

      // delete existing for this date
      const startOfDay = d.startOf('day').tz().toDate()
      const endOfDay = d.endOf('day').tz().toDate()

      await db.$transaction(async (tx) => {
        await tx.courtCostSchedule.deleteMany({
          where: {
            courtId,
            startAt: { gte: startOfDay, lte: endOfDay },
          },
        })
        await tx.slot.deleteMany({
          where: {
            type: SlotType.COURT,
            courtId,
            startAt: { gte: startOfDay, lte: endOfDay },
          },
        })
      })

      const slots: any[] = []
      const happyHours = Array.from({ length: 9 }, (_, i) => i + 6) // 06–14
      const peakHours = Array.from({ length: 9 }, (_, i) => i + 15) // 15–23

      const allHours = [
        ...happyHours.map((h) => ({ hour: h, price: happyHourPrice })),
        ...peakHours.map((h) => ({ hour: h, price: peakHourPrice })),
      ].filter((r) => !closedHours.includes(r.hour))

      for (const { hour, price } of allHours) {
        const startAt = d.hour(hour).minute(0).second(0).tz().toDate()
        const endAt = d
          .hour(hour + 1)
          .minute(0)
          .second(0)
          .tz()
          .toDate()

        slots.push({
          type: SlotType.COURT,
          courtId,
          startAt,
          endAt,
          price,
          isAvailable: true,
        })
      }

      if (slots.length > 0) {
        await db.$transaction(async (tx) => {
          await tx.courtCostSchedule.createMany({
            data: slots.map(
              ({ courtId, startAt, endAt, price, isAvailable }) => ({
                courtId,
                startAt,
                endAt,
                price,
                isAvailable,
              }),
            ),
            skipDuplicates: true,
          })
          await tx.slot.createMany({
            data: slots,
            skipDuplicates: true,
          })
        })
      }
    }

    log.info(
      `Set court pricing for court ${courtId} from ${fromDate} to ${toDate}`,
    )
    return true
  } catch (error) {
    log.fatal(`Error setting court pricing: ${error}`)
    throw error
  }
}

type UpdateCourtPricingPayload = {
  courtId: string
  date: string // YYYY-MM-DD (local)
  happyHourPrice: number // 06–15
  peakHourPrice: number // 15–24
  closedHours?: number[] // 0..23 (default: 0–5 closed)
}

export async function updateCourtPricing({
  courtId,
  date,
  happyHourPrice,
  peakHourPrice,
  closedHours = [0, 1, 2, 3, 4, 5],
}: UpdateCourtPricingPayload) {
  try {
    {
      // 1) Build target hour → price map for the day
      const happy = hoursForBand(HAPPY_START, HAPPY_END).map((h) => ({
        h,
        price: happyHourPrice,
      }))
      const peak = hoursForBand(PEAK_START, PEAK_END).map((h) => ({
        h,
        price: peakHourPrice,
      }))

      const closed = new Set<number>(closedHours)
      const target = [...happy, ...peak].filter((x) => !closed.has(x.h)) // final intended open hours

      // 2) Compute UTC window of the day
      const dayStart = dayjs.tz(date, JAKARTA_TZ).startOf('day').toDate()
      const dayEnd = dayjs.tz(date, JAKARTA_TZ).endOf('day').toDate()

      await db.$transaction(async (tx) => {
        // 3) Load existing COURT slots for that court+date
        const existingSlots = await tx.slot.findMany({
          where: {
            type: SlotType.COURT,
            courtId,
            startAt: { gte: dayStart, lte: dayEnd },
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
            price: true,
            isAvailable: true,
            bookingDetails: { select: { id: true }, take: 1 },
          },
        })

        // Map existing by hour (local) -> support exact hour matching
        const existByHour = new Map<number, (typeof existingSlots)[number]>()
        for (const s of existingSlots) {
          const localHour = dayjs(s.startAt).tz(JAKARTA_TZ).hour()
          existByHour.set(localHour, s)
        }

        // 4) Decide create/update/keep/delete
        const toCreate: Array<{ startAt: Date; endAt: Date; price: number }> =
          []
        const toUpdate: Array<{ id: string; price: number }> = []
        const keepIds = new Set<string>()

        for (const { h, price } of target) {
          const found = existByHour.get(h)
          if (!found) {
            const { startAt, endAt } = toUtcRange(date, h)
            toCreate.push({ startAt, endAt, price })
          } else {
            keepIds.add(found.id)
            // Only update if unbooked AND price differs
            const booked = found.bookingDetails.length > 0
            if (!booked && found.price !== price) {
              toUpdate.push({ id: found.id, price })
            }
          }
        }

        // candidates to delete = existing open hours not in target, and unbooked
        const toDeleteIds = existingSlots
          .filter((s) => !keepIds.has(s.id) && s.bookingDetails.length === 0)
          .map((s) => s.id)

        // 5) Reflect the same in CourtCostSchedule
        const existingCCS = await tx.courtCostSchedule.findMany({
          where: { courtId, startAt: { gte: dayStart, lte: dayEnd } },
          select: { id: true, startAt: true, price: true },
        })
        const ccsByHour = new Map<number, (typeof existingCCS)[number]>()
        for (const r of existingCCS) {
          const h = dayjs(r.startAt).tz(JAKARTA_TZ).hour()
          ccsByHour.set(h, r)
        }

        const ccsCreate: Array<{ startAt: Date; endAt: Date; price: number }> =
          []
        const ccsUpdate: Array<{ id: string; price: number }> = []
        const ccsKeep = new Set<string>()

        for (const { h, price } of target) {
          const row = ccsByHour.get(h)
          if (!row) {
            const { startAt, endAt } = toUtcRange(date, h)
            ccsCreate.push({ startAt, endAt, price })
          } else {
            ccsKeep.add(row.id)
            if (row.price !== price) ccsUpdate.push({ id: row.id, price })
          }
        }
        const ccsDeleteIds = existingCCS
          .filter((r) => !ccsKeep.has(r.id))
          .map((r) => r.id)

        // 6) Apply changes
        if (toDeleteIds.length) {
          await tx.slot.deleteMany({ where: { id: { in: toDeleteIds } } })
        }
        if (toUpdate.length) {
          // batch updates
          for (const u of toUpdate) {
            await tx.slot.update({
              where: { id: u.id },
              data: { price: u.price },
            })
          }
        }
        if (toCreate.length) {
          await tx.slot.createMany({
            data: toCreate.map((x) => ({
              type: SlotType.COURT,
              courtId,
              startAt: x.startAt,
              endAt: x.endAt,
              price: x.price,
              isAvailable: true,
            })),
            skipDuplicates: true,
          })
        }

        if (ccsDeleteIds.length) {
          await tx.courtCostSchedule.deleteMany({
            where: { id: { in: ccsDeleteIds } },
          })
        }
        if (ccsUpdate.length) {
          for (const u of ccsUpdate) {
            await tx.courtCostSchedule.update({
              where: { id: u.id },
              data: { price: u.price },
            })
          }
        }
        if (ccsCreate.length) {
          await tx.courtCostSchedule.createMany({
            data: ccsCreate.map((x) => ({
              courtId,
              startAt: x.startAt,
              endAt: x.endAt,
              price: x.price,
              isAvailable: true,
            })),
            skipDuplicates: true,
          })
        }
      })

      log.info(`Updated court pricing for court ${courtId} on ${date}`)

      return true
    }
  } catch (error) {
    log.fatal(`Error updating court pricing: ${error}`)
    throw error
  }
}

type OverrideSingleCourtHourPricePayload = {
  courtId: string
  date: string
  hour: number
  price: number
}

export async function overrideSingleCourtHourPrice({
  courtId,
  date,
  hour,
  price,
}: OverrideSingleCourtHourPricePayload) {
  try {
    const { startAt, endAt } = toUtcRange(date, hour)

    await db.$transaction(async (tx) => {
      // If slot exists & unbooked → update; else create
      const slot = await tx.slot.findFirst({
        where: { type: SlotType.COURT, courtId, startAt },
        include: { bookingDetails: { select: { id: true }, take: 1 } },
      })

      if (slot) {
        if (slot.bookingDetails.length > 0) return // booked: do nothing
        await tx.slot.update({ where: { id: slot.id }, data: { price } })
      } else {
        await tx.slot.create({
          data: {
            type: SlotType.COURT,
            courtId,
            startAt,
            endAt,
            price,
            isAvailable: true,
          },
        })
      }

      const ccs = await tx.courtCostSchedule.findFirst({
        where: { courtId, startAt },
      })
      if (ccs) {
        await tx.courtCostSchedule.update({
          where: { id: ccs.id },
          data: { price },
        })
      } else {
        await tx.courtCostSchedule.create({
          data: { courtId, startAt, endAt, price, isAvailable: true },
        })
      }
    })

    return true
  } catch (error) {
    log.fatal(`Error overriding single hour price: ${error}`)
    throw error
  }
}

type SetStaffPricingRangePayload = {
  staffId: string
  type: Extract<SlotType, 'COACH' | 'BALLBOY'>
  fromDate: string // YYYY-MM-DD
  toDate: string // YYYY-MM-DD
  days: number[]
  happyHourPrice: number
  peakHourPrice: number
  closedHours?: number[] // default: []
}

export async function setStaffPricingRange(p: SetStaffPricingRangePayload) {
  try {
    const closedSet = new Set(p.closedHours ?? [])
    const start = dayjs(p.fromDate)
    const end = dayjs(p.toDate)

    for (
      let d = start;
      d.isBefore(end) || d.isSame(end, 'day');
      d = d.add(1, 'day')
    ) {
      const dayName = dayNumber(d)
      if (!p.days.includes(dayName)) continue

      const dayStart = d.startOf('day').toDate()
      const dayEnd = d.endOf('day').toDate()

      // remove existing slots for that staff+date+type, then rebuild
      await db.$transaction(async (tx) => {
        await tx.slot.deleteMany({
          where: {
            type: p.type,
            staffId: p.staffId,
            startAt: { gte: dayStart, lte: dayEnd },
            // NOTE: we’re doing a hard refresh. If you prefer to keep booked slots,
            // comment this out and filter by isAvailable: true instead.
          },
        })

        const happy = hoursForBand(HAPPY_START, HAPPY_END).map((h) => ({
          h,
          price: p.happyHourPrice,
        }))
        const peak = hoursForBand(PEAK_START, PEAK_END).map((h) => ({
          h,
          price: p.peakHourPrice,
        }))
        const plan = [...happy, ...peak].filter((x) => !closedSet.has(x.h))

        if (!plan.length) return

        await tx.slot.createMany({
          data: plan.map(({ h, price }) => {
            const { startAt, endAt } = toUtcRange(d.format('YYYY-MM-DD'), h)
            return {
              type: p.type,
              staffId: p.staffId,
              startAt,
              endAt,
              price,
              isAvailable: true,
            }
          }),
          skipDuplicates: true,
        })
      })
    }
    return true
  } catch (error) {
    log.fatal(`Error setting staff pricing range: ${error}`)
    throw error
  }
}

// ---------- 2) SINGLE-DAY UPDATE (safe diff)
type UpdateStaffPricingPayload = {
  staffId: string
  type: Extract<SlotType, 'COACH' | 'BALLBOY'>
  date: string // YYYY-MM-DD
  happyHourPrice: number // 06–15
  peakHourPrice: number // 15–24
  closedHours?: number[] // hours to remove/close (default: none)
}

export async function updateStaffPricing(p: UpdateStaffPricingPayload) {
  try {
    const d = dayjs(p.date)
    const dayStart = d.startOf('day').toDate()
    const dayEnd = d.endOf('day').toDate()
    const closed = new Set(p.closedHours ?? [])

    const happy = hoursForBand(HAPPY_START, HAPPY_END).map((h) => ({
      h,
      price: p.happyHourPrice,
    }))
    const peak = hoursForBand(PEAK_START, PEAK_END).map((h) => ({
      h,
      price: p.peakHourPrice,
    }))
    const target = [...happy, ...peak].filter((x) => !closed.has(x.h)) // desired open hours

    await db.$transaction(async (tx) => {
      const existing = await tx.slot.findMany({
        where: {
          type: p.type,
          staffId: p.staffId,
          startAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          startAt: true,
          price: true,
          _count: {
            select: {
              bookingCoaches: true, // for COACH slots
              bookingBallboys: true, // for BALLBOY slots
            },
          },
        },
      })

      // index existing by local hour
      const byHour = new Map<number, (typeof existing)[number]>()
      for (const s of existing) {
        const h = dayjs(s.startAt).tz(JAKARTA_TZ).hour()
        byHour.set(h, s)
      }

      const keepIds = new Set<string>()
      const toCreate: Array<{ startAt: Date; endAt: Date; price: number }> = []
      const toUpdate: Array<{ id: string; price: number }> = []

      for (const { h, price } of target) {
        const found = byHour.get(h)
        if (!found) {
          const { startAt, endAt } = toUtcRange(p.date, h)
          toCreate.push({ startAt, endAt, price })
        } else {
          keepIds.add(found.id)
          const bookedCount =
            p.type === SlotType.COACH
              ? found._count.bookingCoaches
              : found._count.bookingBallboys
          const isBooked = bookedCount > 0
          if (!isBooked && found.price !== price) {
            toUpdate.push({ id: found.id, price })
          }
        }
      }

      // delete hours that are NOT in target (and unbooked)
      const toDeleteIds = existing
        .filter((e) => !keepIds.has(e.id))
        .filter((e) => {
          const bookedCount =
            p.type === SlotType.COACH
              ? e._count.bookingCoaches
              : e._count.bookingBallboys
          return bookedCount === 0
        })
        .map((e) => e.id)

      if (toDeleteIds.length) {
        await tx.slot.deleteMany({ where: { id: { in: toDeleteIds } } })
      }

      for (const u of toUpdate) {
        await tx.slot.update({ where: { id: u.id }, data: { price: u.price } })
      }

      if (toCreate.length) {
        await tx.slot.createMany({
          data: toCreate.map((x) => ({
            type: p.type,
            staffId: p.staffId,
            startAt: x.startAt,
            endAt: x.endAt,
            price: x.price,
            isAvailable: true,
          })),
          skipDuplicates: true,
        })
      }
    })

    return true
  } catch (error) {
    log.fatal(`Error updating staff pricing: ${error}`)
    throw error
  }
}

type OverrideSingleBallboyCostPayload = {
  staffId: string
  type: Extract<SlotType, 'COACH' | 'BALLBOY'>
  date: string
  hour: number
  price: number
}
// ---------- 3) One-hour override (e.g., promo or manual edit)
export async function overrideStaffHourPrice({
  staffId,
  type,
  date,
  hour,
  price,
}: OverrideSingleBallboyCostPayload) {
  try {
    const { startAt, endAt } = toUtcRange(date, hour)

    await db.$transaction(async (tx) => {
      const slot = await tx.slot.findFirst({
        where: { type, staffId, startAt },
        select: {
          id: true,
          _count: {
            select: {
              bookingCoaches: true,
              bookingBallboys: true,
            },
          },
        },
      })

      if (slot) {
        const booked =
          type === SlotType.COACH
            ? slot._count.bookingCoaches > 0
            : slot._count.bookingBallboys > 0
        if (!booked) {
          await tx.slot.update({ where: { id: slot.id }, data: { price } })
        }
      } else {
        await tx.slot.create({
          data: { type, staffId, startAt, endAt, price, isAvailable: true },
        })
      }
    })
    return true
  } catch (error) {
    log.fatal(`Error overriding staff hour price: ${error}`)
    throw error
  }
}
