import { err } from '@/lib/response'
import type { NotFoundHandler } from 'hono'
import status from 'http-status'

const onNotFound: NotFoundHandler = (c) => {
  return c.json(
    err(`Resource not found: ${c.req.path}`, status.NOT_FOUND),
    status.NOT_FOUND,
  )
}

export default onNotFound
