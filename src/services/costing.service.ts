import { log } from '@/lib/logger'
import { db } from '@/lib/prisma'
import { BookingStatus, SlotType } from '@prisma/client'
import dayjs from 'dayjs'

type SetCourtPricingPayload = {
  courtId: string
  fromDate: string // YYYY-MM-DD
  toDate: string // YYYY-MM-DD
  days: number[] // 1=Mon, 2=Tue, ..., 7=Sun
  happyHourPrice: number
  happyHourDiscountPrice?: number
  peakHourPrice: number
  peakHourDiscountPrice?: number
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
  const startAt = dayjs(dateISO).hour(hour).minute(0).second(0).millisecond(0)
  const next =
    hour + 1 === 24
      ? dayjs(dateISO).add(1, 'day').hour(0)
      : dayjs(dateISO).hour(hour + 1)
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
  happyHourDiscountPrice = 0,
  peakHourPrice,
  peakHourDiscountPrice = 0,
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

      // delete existing for this date - use timezone-aware dates
      const startOfDay = dayjs(d.format('YYYY-MM-DD')).startOf('day').toDate()
      const endOfDay = dayjs(d.format('YYYY-MM-DD')).endOf('day').toDate()

      await db.$transaction(async (tx) => {
        // First, find slots that can be safely deleted (no bookings)
        const slotsToCheck = await tx.slot.findMany({
          where: {
            type: SlotType.COURT,
            courtId,
            startAt: { gte: startOfDay, lte: endOfDay },
          },
          select: {
            id: true,
            bookingDetails: {
              select: { id: true },
            },
          },
        })

        // Only delete slots that have no booking details
        const slotsToDelete = slotsToCheck
          .filter((s) => s.bookingDetails.length === 0)
          .map((s) => s.id)

        await tx.courtCostSchedule.deleteMany({
          where: {
            courtId,
            startAt: { gte: startOfDay, lte: endOfDay },
          },
        })

        if (slotsToDelete.length > 0) {
          await tx.slot.deleteMany({
            where: {
              id: { in: slotsToDelete },
            },
          })
        }
      })

      const slots: any[] = []
      const happyHours = Array.from({ length: 9 }, (_, i) => i + 6) // 06–14
      const peakHours = Array.from({ length: 9 }, (_, i) => i + 15) // 15–23

      const allHours = [
        ...happyHours.map((h) => ({
          hour: h,
          price: happyHourPrice,
          discountPrice: happyHourDiscountPrice,
        })),
        ...peakHours.map((h) => ({
          hour: h,
          price: peakHourPrice,
          discountPrice: peakHourDiscountPrice,
        })),
      ].filter((r) => !closedHours.includes(r.hour))

      for (const { hour, price, discountPrice } of allHours) {
        const startAt = d.hour(hour).minute(0).second(0).toDate()
        const endAt = d
          .hour(hour + 1)
          .minute(0)
          .second(0)
          .toDate()

        slots.push({
          type: SlotType.COURT,
          courtId,
          startAt,
          endAt,
          price,
          discountPrice,
          isAvailable: true,
        })
      }

      if (slots.length > 0) {
        await db.$transaction(async (tx) => {
          await tx.courtCostSchedule.createMany({
            data: slots.map(
              ({
                courtId,
                startAt,
                endAt,
                price,
                discountPrice,
                isAvailable,
              }) => ({
                courtId,
                startAt,
                endAt,
                price,
                discountPrice,
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
  happyHourDiscountPrice?: number
  peakHourPrice: number // 15–24
  peakHourDiscountPrice?: number
  closedHours?: number[] // 0..23 (default: 0–5 closed)
}

export async function updateCourtPricing({
  courtId,
  date,
  happyHourPrice,
  happyHourDiscountPrice = 0,
  peakHourPrice,
  peakHourDiscountPrice = 0,
  closedHours = [0, 1, 2, 3, 4, 5],
}: UpdateCourtPricingPayload) {
  try {
    {
      // 1) Build target hour → price map for the day
      const happy = hoursForBand(HAPPY_START, HAPPY_END).map((h) => ({
        h,
        price: happyHourPrice,
        discountPrice: happyHourDiscountPrice,
      }))
      const peak = hoursForBand(PEAK_START, PEAK_END).map((h) => ({
        h,
        price: peakHourPrice,
        discountPrice: peakHourDiscountPrice,
      }))

      const closed = new Set<number>(closedHours)
      const target = [...happy, ...peak].filter((x) => !closed.has(x.h)) // final intended open hours

      // 2) Compute UTC window of the day
      const dayStart = dayjs(date).startOf('day').toDate()
      const dayEnd = dayjs(date).endOf('day').toDate()

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
            discountPrice: true,
            isAvailable: true,
            bookingDetails: {
              where: {
                booking: {
                  status: {
                    not: BookingStatus.CANCELLED,
                  },
                },
              },
              select: { id: true },
              take: 1,
            },
          },
        })

        // Map existing by hour (local) -> support exact hour matching
        const existByHour = new Map<number, (typeof existingSlots)[number]>()
        for (const s of existingSlots) {
          const localHour = dayjs(s.startAt).hour()
          existByHour.set(localHour, s)
        }

        // 4) Decide create/update/keep/delete
        const toCreate: Array<{
          startAt: Date
          endAt: Date
          price: number
          discountPrice: number
        }> = []
        const toUpdate: Array<{
          id: string
          price: number
          discountPrice: number
        }> = []
        const keepIds = new Set<string>()

        for (const { h, price, discountPrice } of target) {
          const found = existByHour.get(h)
          if (!found) {
            const { startAt, endAt } = toUtcRange(date, h)
            toCreate.push({ startAt, endAt, price, discountPrice })
          } else {
            keepIds.add(found.id)
            // Only update if unbooked AND price differs
            const booked = found.bookingDetails.length > 0
            if (
              !booked &&
              (found.price !== price || found.discountPrice !== discountPrice)
            ) {
              toUpdate.push({ id: found.id, price, discountPrice })
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
          select: { id: true, startAt: true, price: true, discountPrice: true },
        })
        const ccsByHour = new Map<number, (typeof existingCCS)[number]>()
        for (const r of existingCCS) {
          const h = dayjs(r.startAt).hour()
          ccsByHour.set(h, r)
        }

        const ccsCreate: Array<{
          startAt: Date
          endAt: Date
          price: number
          discountPrice: number
        }> = []
        const ccsUpdate: Array<{
          id: string
          price: number
          discountPrice: number
        }> = []
        const ccsKeep = new Set<string>()

        for (const { h, price, discountPrice } of target) {
          const row = ccsByHour.get(h)
          if (!row) {
            const { startAt, endAt } = toUtcRange(date, h)
            ccsCreate.push({ startAt, endAt, price, discountPrice })
          } else {
            ccsKeep.add(row.id)
            if (row.price !== price || row.discountPrice !== discountPrice) {
              ccsUpdate.push({ id: row.id, price, discountPrice })
            }
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
              data: { price: u.price, discountPrice: u.discountPrice },
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
              discountPrice: x.discountPrice,
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
              data: { price: u.price, discountPrice: u.discountPrice },
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
              discountPrice: x.discountPrice,
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
  discountPrice?: number
}

export async function overrideSingleCourtHourPrice({
  courtId,
  date,
  hour,
  price,
  discountPrice = 0,
}: OverrideSingleCourtHourPricePayload) {
  try {
    const { startAt, endAt } = toUtcRange(date, hour)

    await db.$transaction(async (tx) => {
      // If slot exists & unbooked → update; else create
      const slot = await tx.slot.findFirst({
        where: { type: SlotType.COURT, courtId, startAt },
        include: {
          bookingDetails: {
            where: {
              booking: {
                status: {
                  not: BookingStatus.CANCELLED,
                },
              },
            },
            select: { id: true },
            take: 1,
          },
        },
      })

      if (slot) {
        if (slot.bookingDetails.length > 0) return // booked: do nothing
        await tx.slot.update({
          where: { id: slot.id },
          data: { price, discountPrice },
        })
      } else {
        await tx.slot.create({
          data: {
            type: SlotType.COURT,
            courtId,
            startAt,
            endAt,
            price,
            discountPrice,
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
          data: { price, discountPrice },
        })
      } else {
        await tx.courtCostSchedule.create({
          data: {
            courtId,
            startAt,
            endAt,
            price,
            discountPrice,
            isAvailable: true,
          },
        })
      }
    })

    return true
  } catch (error) {
    log.fatal(`Error overriding single hour price: ${error}`)
    throw error
  }
}

type UpdateSlotPricingPayload = {
  slotId: string
  price: number
  discountPrice?: number
}

export async function updateSlotPricing({
  slotId,
  price,
  discountPrice = 0,
}: UpdateSlotPricingPayload) {
  try {
    const slot = await db.slot.findUnique({
      where: { id: slotId },
      include: {
        bookingDetails: {
          where: {
            booking: {
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
          },
          select: { id: true },
          take: 1,
        },
      },
    })

    if (!slot) {
      log.warn(`Slot not found: ${slotId}`)
      return false
    }

    // Prevent updating prices for slots with active bookings
    if (slot.bookingDetails.length > 0) {
      log.warn(`Cannot update pricing for slot ${slotId} with active bookings`)
      return false
    }

    await db.$transaction(async (tx) => {
      // Update the slot
      await tx.slot.update({
        where: { id: slotId },
        data: { price, discountPrice },
      })

      // Also update CourtCostSchedule if it exists
      if (slot.type === SlotType.COURT) {
        const ccs = await tx.courtCostSchedule.findFirst({
          where: { courtId: slot.courtId, startAt: slot.startAt },
        })
        if (ccs) {
          await tx.courtCostSchedule.update({
            where: { id: ccs.id },
            data: { price, discountPrice },
          })
        }
      }
    })

    log.info(
      `Updated slot ${slotId} pricing - price: ${price}, discountPrice: ${discountPrice}`,
    )
    return true
  } catch (error) {
    log.fatal(`Error updating slot pricing: ${error}`)
    throw error
  }
}

type BulkUpdateCourtSlotPricingPayload = {
  courtId: string
  fromDate: string
  toDate: string
  days: number[]
  startHour: number
  endHour: number
  price: number
  discountPrice?: number
}

export async function bulkUpdateCourtSlotPricing({
  courtId,
  fromDate,
  toDate,
  days,
  startHour,
  endHour,
  price,
  discountPrice = 0,
}: BulkUpdateCourtSlotPricingPayload) {
  try {
    const rangeStart = dayjs(fromDate).startOf('day')
    const rangeEnd = dayjs(toDate).endOf('day')
    const selectedDays = new Set(days)

    const slots = await db.slot.findMany({
      where: {
        type: SlotType.COURT,
        courtId,
        startAt: {
          gte: rangeStart.toDate(),
          lte: rangeEnd.toDate(),
        },
      },
      include: {
        bookingDetails: {
          where: {
            booking: {
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
          },
          select: { id: true },
          take: 1,
        },
      },
    })

    const matchedSlots = slots.filter((slot) => {
      const start = dayjs(slot.startAt)
      const hour = start.hour()
      return (
        selectedDays.has(dayNumber(start)) &&
        hour >= startHour &&
        hour < endHour
      )
    })

    const updatableSlots = matchedSlots.filter(
      (slot) => slot.bookingDetails.length === 0,
    )
    const updatableSlotIds = updatableSlots.map((slot) => slot.id)
    const updatableStartTimes = updatableSlots.map((slot) => slot.startAt)

    await db.$transaction(async (tx) => {
      if (updatableSlotIds.length) {
        await tx.slot.updateMany({
          where: { id: { in: updatableSlotIds } },
          data: { price, discountPrice },
        })
      }

      if (updatableStartTimes.length) {
        await tx.courtCostSchedule.updateMany({
          where: {
            courtId,
            startAt: { in: updatableStartTimes },
          },
          data: { price, discountPrice },
        })
      }
    })

    const result = {
      matchedCount: matchedSlots.length,
      updatedCount: updatableSlots.length,
      skippedBookedCount: matchedSlots.length - updatableSlots.length,
    }

    log.info(
      `Bulk updated court ${courtId} slot pricing: ${JSON.stringify(result)}`,
    )

    return result
  } catch (error) {
    log.fatal(`Error bulk updating court slot pricing: ${error}`)
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

      // Use timezone-aware dates for consistency with Jakarta timezone
      const dayStart = dayjs(d.format('YYYY-MM-DD')).startOf('day').toDate()
      const dayEnd = dayjs(d.format('YYYY-MM-DD')).endOf('day').toDate()

      // remove existing slots for that staff+date+type, then rebuild
      await db.$transaction(async (tx) => {
        // First, find slots that can be safely deleted (no bookings)
        const slotsToCheck = await tx.slot.findMany({
          where: {
            type: p.type,
            staffId: p.staffId,
            startAt: { gte: dayStart, lte: dayEnd },
          },
          select: {
            id: true,
            bookingCoaches: {
              select: { id: true },
            },
            bookingBallboys: {
              select: { id: true },
            },
          },
        })

        // Only delete slots that have no bookings at all
        const slotsToDelete = slotsToCheck
          .filter((s) => {
            const hasCoachBookings = s.bookingCoaches.length > 0
            const hasBallboyBookings = s.bookingBallboys.length > 0
            return !hasCoachBookings && !hasBallboyBookings
          })
          .map((s) => s.id)

        if (slotsToDelete.length > 0) {
          await tx.slot.deleteMany({
            where: {
              id: { in: slotsToDelete },
            },
          })
        }

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
          bookingCoaches: {
            where: {
              status: {
                not: BookingStatus.CANCELLED,
              },
              booking: {
                status: {
                  not: BookingStatus.CANCELLED,
                },
              },
            },
            select: { id: true },
          },
          bookingBallboys: {
            where: {
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
            select: { id: true },
          },
        },
      })

      // Also check for ALL booking coaches/ballboys (including cancelled) to prevent FK constraint violations
      const allSlotIds = existing.map((s) => s.id)
      const allBookingCoaches =
        p.type === SlotType.COACH
          ? await tx.bookingCoach.findMany({
              where: { slotId: { in: allSlotIds } },
              select: { slotId: true },
            })
          : []
      const allBookingBallboys =
        p.type === SlotType.BALLBOY
          ? await tx.bookingBallboy.findMany({
              where: { slotId: { in: allSlotIds } },
              select: { slotId: true },
            })
          : []

      // Create a map of slot IDs that have ANY bookings (regardless of status)
      const slotsWithAnyBookings = new Set<string>()
      for (const bc of allBookingCoaches) {
        slotsWithAnyBookings.add(bc.slotId)
      }
      for (const bb of allBookingBallboys) {
        slotsWithAnyBookings.add(bb.slotId)
      }

      // index existing by local hour
      const byHour = new Map<number, (typeof existing)[number]>()
      for (const s of existing) {
        const h = dayjs(s.startAt).hour()
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
              ? found.bookingCoaches.length
              : found.bookingBallboys.length
          const isBooked = bookedCount > 0
          if (!isBooked && found.price !== price) {
            toUpdate.push({ id: found.id, price })
          }
        }
      }

      // delete hours that are NOT in target (and unbooked)
      // Must check for ANY bookings (including cancelled) to prevent FK constraint violations
      const toDeleteIds = existing
        .filter((e) => !keepIds.has(e.id))
        .filter((e) => {
          // Check if slot has any active bookings (non-cancelled)
          const activeBookedCount =
            p.type === SlotType.COACH
              ? e.bookingCoaches.length
              : e.bookingBallboys.length

          // Also check if slot has ANY bookings at all (including cancelled) to prevent FK violations
          const hasAnyBookings = slotsWithAnyBookings.has(e.id)

          // Only delete if no active bookings AND no bookings at all exist
          return activeBookedCount === 0 && !hasAnyBookings
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
          bookingCoaches: {
            where: {
              status: {
                not: BookingStatus.CANCELLED,
              },
              booking: {
                status: {
                  not: BookingStatus.CANCELLED,
                },
              },
            },
            select: { id: true },
          },
          bookingBallboys: {
            where: {
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
            select: { id: true },
          },
        },
      })

      if (slot) {
        const booked =
          type === SlotType.COACH
            ? slot.bookingCoaches.length > 0
            : slot.bookingBallboys.length > 0
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
