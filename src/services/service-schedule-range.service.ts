import { Prisma, type CourtSport } from '@prisma/client'
import { branchContext, withBranchContext } from '@/lib/branch-context'
import { db } from '@/lib/prisma'
import {
  ballboySportWhere,
  buildRollingCoachingSlots,
  rollingCoachingScheduleSchema,
} from '@/lib/coaching-policy'
import { rollingBookingWindowWhere } from '@/lib/rolling-booking-window'

/** Fill only missing rolling service slots for the requested hour. Existing rows,
 * including manual closures and booked slots, are never rewritten by this read. */
export async function ensureServiceScheduleRange(
  branchId: string,
  sport: CourtSport,
  startAt: Date,
  endAt: Date,
  now = new Date(),
) {
  const peopleWhere = {
    branchId,
    isActive: true,
    rollingServiceSchedule: { not: Prisma.AnyNull },
    OR: [
      {
        role: 'COACH' as const,
        coachType: { in: [sport, 'PADEL_TENNIS' as const] },
      },
      { role: 'BALLBOY' as const, ...ballboySportWhere(sport) },
    ],
  } satisfies Prisma.StaffWhereInput
  const people = await db.staff.findMany({
    where: peopleWhere,
    select: { id: true, rollingServiceSchedule: true },
  })
  const candidates = people.filter(
    (person) =>
      buildRollingCoachingSlots(
        rollingCoachingScheduleSchema.parse(person.rollingServiceSchedule),
        [{ startAt, endAt }],
        now,
      ).length > 0,
  )
  const eligibleIds = new Set(candidates.map((person) => person.id))
  const excluded = people
    .filter((person) => !eligibleIds.has(person.id))
    .map((person) => person.id)
  if (!candidates.length) return excluded
  const [existing, court] = await Promise.all([
    db.slot.findMany({
      where: {
        branchId,
        staffId: { in: candidates.map((person) => person.id) },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { staffId: true },
    }),
    db.slot.findFirst({
      where: {
        branchId,
        type: 'COURT',
        startAt,
        endAt,
        ...rollingBookingWindowWhere(now),
        court: { isActive: true, sport, bookingWindowMonths: { not: null } },
      },
      select: { id: true },
    }),
  ])
  if (!court) return people.map((person) => person.id)
  const present = new Set(existing.map((slot) => slot.staffId))
  const missing = candidates.filter((person) => !present.has(person.id))
  if (!missing.length) return excluded
  const fill = () =>
    db.$transaction(async (tx) => {
      const ids = missing.map((person) => person.id).sort()
      await tx.$queryRaw`SELECT id FROM staff WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
      const [freshPeople, overlaps] = await Promise.all([
        tx.staff.findMany({ where: { ...peopleWhere, id: { in: ids } } }),
        tx.slot.findMany({
          where: {
            branchId,
            staffId: { in: ids },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
          select: { staffId: true },
        }),
      ])
      const occupiedIds = new Set(overlaps.map((slot) => slot.staffId))
      const data: Prisma.SlotCreateManyInput[] = freshPeople.flatMap(
        (person) => {
          if (occupiedIds.has(person.id)) return []
          const config = rollingCoachingScheduleSchema.parse(
            person.rollingServiceSchedule,
          )
          return buildRollingCoachingSlots(
            config,
            [{ startAt, endAt }],
            now,
          ).map((slot) => ({
            ...slot,
            branchId,
            staffId: person.id,
            type: person.role === 'BALLBOY' ? 'BALLBOY' : 'COACH',
            additionalHourPrice:
              person.role === 'COACH'
                ? (config.additionalHourPrice ?? null)
                : null,
            isAvailable: true,
          }))
        },
      )
      if (data.length) await tx.slot.createMany({ data, skipDuplicates: true })
    })
  const context = branchContext.getStore()
  if (context && !context.branchId && context.isSuperAdmin)
    await withBranchContext({ ...context, branchId }, fill)
  else await fill()
  return excluded
}
