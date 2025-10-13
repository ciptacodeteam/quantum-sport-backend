import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { timeout } from 'hono/timeout'
import { trimTrailingSlash } from 'hono/trailing-slash'
import { env } from './env'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  timeoutException,
  UnauthorizedException,
} from './exceptions'
import { corsMiddlewareOptions } from './lib/cors'

import dayjs from 'dayjs'
import 'dayjs/locale/id'
import { HTTPException } from 'hono/http-exception'
import { StatusCode } from 'hono/utils/http-status'
import status from 'http-status'
import { logger } from './lib/logger'
import docsRoute from './routes/docs'
import homeRoute from './routes/home'

dayjs.locale('id')

const app = new Hono()

app.use('*', csrf({ origin: env.corsOrigins }))
app.use('*', corsMiddlewareOptions)
app.use('*', trimTrailingSlash())
app.use('*', timeout(5 * 60 * 1000, timeoutException)) // 5 minutes

app.route('/', homeRoute).route('/docs', docsRoute)

app.notFound((c) => {
  throw new NotFoundException(c)
})

app.onError((err, c) => {
  logger.fatal(err)
  console.error('[Hono Error]', err)

  let statusCode: StatusCode = status.INTERNAL_SERVER_ERROR
  let message = 'Internal Server Error'

  if (
    err instanceof NotFoundException ||
    err instanceof HTTPException ||
    err instanceof UnauthorizedException ||
    err instanceof ForbiddenException ||
    err instanceof BadRequestException
  ) {
    statusCode = (err.status as StatusCode) ?? status.INTERNAL_SERVER_ERROR
    message = err.message
  } else if (err instanceof Error) {
    message = err.message
  }

  c.status(statusCode)
  return c.json({ status: false, msg: message })
})

export default app
