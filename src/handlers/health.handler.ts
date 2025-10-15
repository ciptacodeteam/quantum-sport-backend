import { ok } from '@/lib/response'
import { healthRouteDoc } from '@/routes/health.route'
import { AppRouteHandler } from '@/types'
import dayjs from 'dayjs'

export const healthCheckHandler: AppRouteHandler<healthRouteDoc> = async (
  c,
) => {
  return c.json(
    ok(
      { up: true, ts: dayjs().toISOString() },
      `Server is healthy at ${dayjs().toISOString()}`,
    ),
  )
}
