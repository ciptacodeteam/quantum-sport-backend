import { z } from 'zod'
const line = z.object({
  isInHouse: z.boolean().default(false),
  serviceId: z.string(),
  kind: z.enum(['COACH', 'BALLBOY']),
  amount: z.number().int().nonnegative(),
  staffId: z.string().nullable(),
  staffName: z.string(),
  clubId: z.string().nullable(),
  clubName: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string(),
})
export const rescheduleChargeSchema = z.object({
  courtName: z.string().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  source: z.literal('ADMIN_COURT_RESCHEDULE'),
  detailId: z.string(),
  courtBookingId: z.string(),
  courtAmount: z.number().int().nonnegative(),
  services: z.array(line),
})
export type RescheduleCharge = z.infer<typeof rescheduleChargeSchema>
export function readRescheduleCharge(meta: unknown): RescheduleCharge | null {
  const result = rescheduleChargeSchema.safeParse(meta)
  return result.success ? result.data : null
}

export const rescheduleSourceSelect = {
  status: true,
  coaches: { select: { id: true, status: true, isClubSettled: true } },
  ballboys: { select: { id: true, status: true } },
  serviceBookings: {
    select: {
      coaches: { select: { id: true, status: true, isClubSettled: true } },
      ballboys: { select: { id: true, status: true } },
    },
  },
} as const
export function rescheduleServiceState(
  booking: any,
  serviceId: string,
): { status?: string; isClubSettled?: boolean } | undefined {
  const root = booking?.serviceForBooking
  return [root, ...(root?.serviceBookings ?? [])]
    .flatMap((item) => [...(item?.coaches ?? []), ...(item?.ballboys ?? [])])
    .find((item) => item.id === serviceId)
}
