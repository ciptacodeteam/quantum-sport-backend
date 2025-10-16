import { timeout } from 'hono/timeout'
import { trimTrailingSlash } from 'hono/trailing-slash'

import { timeoutException } from '@/exceptions'
import { globalAuthMiddleware } from '@/middlewares/auth'
import onError from '@/middlewares/error'
import onNotFound from '@/middlewares/not-found'
import serveEmojiFavicon from '@/middlewares/serve-emoji-favicon'
import type { AppEnv } from '@/types'
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { corsMiddlewareOptions } from './cors'
import { logger } from './logger'
import { createFactory } from 'hono/factory'

export const createRouter = () => {
  return new Hono<AppEnv>({
    strict: false,
  })
}

export const factory = createFactory<AppEnv>({
  defaultAppOptions: { strict: false },
})

export default function createApp() {
  const app = createRouter()

  app.use(serveEmojiFavicon('🏓'))
  app.use(corsMiddlewareOptions)
  app.use(trimTrailingSlash())
  app.use(requestId())
  app.use(logger())
  app.use(globalAuthMiddleware)
  app.use(timeout(5 * 60 * 1000, timeoutException)) // 5 minutes

  app.notFound(onNotFound)
  app.onError(onError)

  return app
}
