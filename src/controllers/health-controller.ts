import { ok } from '@/lib/response'
import { AppEnv } from '@/types'
import dayjs from 'dayjs'
import { Context } from 'hono'

export async function getApiHealth(c: Context<AppEnv>) {
  return c.json(
    ok(
      { up: true, ts: dayjs().toISOString() },
      `Server is healthy at ${dayjs().toISOString()}`,
    ),
  )
}
