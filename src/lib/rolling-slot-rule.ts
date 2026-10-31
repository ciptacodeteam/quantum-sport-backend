import { z } from 'zod'
import dayjs from '@/lib/club-time'

const filter = {
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.array(z.number().int().min(1).max(7)).min(1),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
}
export const rollingSlotRuleSchema = z
  .discriminatedUnion('kind', [
    z.object({ ...filter, kind: z.literal('disable') }),
    z.object({
      ...filter,
      kind: z.literal('pricing'),
      price: z.number().int().min(0).max(2147483647),
      discountPrice: z.number().int().min(0).max(2147483647).default(0),
    }),
  ])
  .superRefine((rule, ctx) => {
    if (rule.endHour <= rule.startHour)
      ctx.addIssue({
        code: 'custom',
        path: ['endHour'],
        message: 'Invalid hour range',
      })
    if (rule.kind === 'pricing' && rule.discountPrice > rule.price)
      ctx.addIssue({
        code: 'custom',
        path: ['discountPrice'],
        message: 'Discount cannot exceed price',
      })
  })
export type RollingSlotRule = z.infer<typeof rollingSlotRuleSchema>

export function matchesRollingSlotRule(startAt: Date, rule: RollingSlotRule) {
  const start = dayjs(startAt)
  return (
    start.format('YYYY-MM-DD') >= rule.fromDate &&
    rule.days.includes(start.day() || 7) &&
    start.hour() >= rule.startHour &&
    start.hour() < rule.endHour
  )
}
