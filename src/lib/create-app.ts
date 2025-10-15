import { csrf } from 'hono/csrf'
import { timeout } from 'hono/timeout'
import { trimTrailingSlash } from 'hono/trailing-slash'

import { env } from '@/env'
import { timeoutException } from '@/exceptions'
import { globalAuthMiddleware } from '@/middlewares/authentication'
import serveEmojiFavicon from '@/middlewares/serve-emoji-favicon'
import type { AppBinding } from '@/types'
import { OpenAPIHono } from '@hono/zod-openapi'
import { requestId } from 'hono/request-id'
import { corsMiddlewareOptions } from './cors'
import { logger } from './logger'
import onNotFound from '@/middlewares/not-found'
import onError from '@/middlewares/error'
import { defaultHook } from './configure-openapi'

export const createRouter = () => {
  return new OpenAPIHono<AppBinding>({
    strict: false,
    defaultHook,
  })
}

export default function createApp() {
  const app = createRouter()

  app.use(csrf({ origin: env.corsOrigins }))
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
