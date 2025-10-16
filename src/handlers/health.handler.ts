import { factory } from '@/lib/create-app'
import { ok } from '@/lib/response'
import dayjs from 'dayjs'

export const healthCheckHandler = factory.createHandlers((c) => {
  return c.json(
    ok(
      { up: true, ts: dayjs().toISOString() },
      `Server is healthy at ${dayjs().toISOString()}`,
    ),
  )
})
