import { ok } from '@/lib/response'
import dayjs from 'dayjs'
import { Hono } from 'hono'
import status from 'http-status'

const homeRoute = new Hono()
  .get('/', (c) => {
    return c.json(ok(null, 'Welcome to Quantum Sport API!'), status.OK)
  })
  .get('/health', (c) =>
    c.json(
      ok(
        { up: true, ts: dayjs().format('YYYY-MM-DD HH:mm:ss') },
        `Server is healthy at ${dayjs().toISOString()}`,
      ),
    ),
  )

export type AppType = typeof homeRoute
export default homeRoute
