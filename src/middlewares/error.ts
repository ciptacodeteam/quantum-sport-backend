import { env } from '@/env'
import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import status from 'http-status'
import { err as errResFormatter } from '@/lib/response'
import { ZodError } from 'zod'

const onError: ErrorHandler = (err, c) => {
  const currentStatus =
    'status' in err ? err.status : c.newResponse(null).status

  const statusCode =
    currentStatus !== status.OK
      ? (currentStatus as ContentfulStatusCode)
      : status.INTERNAL_SERVER_ERROR

  const envMode = c.env?.NODE_ENV || env.nodeEnv

  if (err instanceof ZodError) {
    c.var.logger?.error(`[Zod Error]: ${err.flatten()}`)
    return c.json(
      errResFormatter(
        'Validation Error',
        400,
        envMode === 'production' ? undefined : err.flatten(),
      ),
      400,
    )
  }

  c.var.logger?.error(`[Hono Error]: ${err}`)

  return c.json(
    errResFormatter(
      err.message || 'Internal Server Error',
      statusCode,
      envMode === 'production' ? undefined : err.stack,
    ),
    statusCode,
  )
}

export default onError
