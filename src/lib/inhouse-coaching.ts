import { z } from 'zod'
import { BadRequestException } from '@/exceptions'

const money = z.number().int().min(0).max(100000000)
export const inHousePlanSchema = z
  .object({
    staffId: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    hours: z.number().int().positive().max(35791394),
    hourlyPrice: money.refine((v) => v > 0),
    courtHourlyShare: money,
    extraParticipantHourlyPrice: z.literal(100000).default(100000),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine(
    (v) => v.courtHourlyShare <= v.hourlyPrice,
    'Bagian lapangan melebihi harga paket.',
  )
const sessionFields = {
  courtSlotId: z.string().min(1),
  coachSlotId: z.string().min(1),
  participants: z.number().int().min(1).max(100),
}
export const INHOUSE_COACH_TYPE = 'Coaching In-house'
export const inHouseSelectionSchema = z.union([
  z.object({ walletId: z.string().min(1), ...sessionFields }).strict(),
  z.object({ planId: z.string().min(1), ...sessionFields }).strict(),
  z.object({ staffId: z.string().min(1), ...sessionFields }).strict(),
])
export type InHouseSelection = z.infer<typeof inHouseSelectionSchema>

export function priceInHouseHour(
  terms: {
    hourlyPrice: number
    courtHourlyShare: number
    extraParticipantHourlyPrice: number
  },
  participants: number,
) {
  if (!Number.isInteger(participants) || participants < 1 || participants > 100)
    throw new BadRequestException('Jumlah peserta tidak valid.')
  const extraAmount = (participants - 1) * terms.extraParticipantHourlyPrice
  return {
    courtAmount: terms.courtHourlyShare,
    coachAmount: terms.hourlyPrice - terms.courtHourlyShare,
    extraAmount,
  }
}

export function isInHouseService(item: {
  inHouseUsage?: unknown
  bookingCoachType?: { name: string } | null
}) {
  return (
    !!item.inHouseUsage || item.bookingCoachType?.name === INHOUSE_COACH_TYPE
  )
}
