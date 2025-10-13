import { ok } from 'assert'
import dayjs from 'dayjs'
import { Context } from 'hono'

export async function getApiHealth(c: Context) {
  return c.json(
    ok(
      { up: true, ts: dayjs().format('YYYY-MM-DD HH:mm:ss') },
      `Server is healthy at ${dayjs().toISOString()}`,
    ),
  )
}
