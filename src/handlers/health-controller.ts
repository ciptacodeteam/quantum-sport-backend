import { ok } from '@/lib/response'
import { HealthRoute } from '@/routes/health.route'
import { AppRouteHandler } from '@/types'
import dayjs from 'dayjs'

export const healthCheckHandler: AppRouteHandler<HealthRoute> = async (c) => {
  return c.json(
    ok(
      { up: true, ts: dayjs().toISOString() },
      `Server is healthy at ${dayjs().toISOString()}`,
    ),
  )
}
