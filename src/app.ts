import dayjs from 'dayjs'
import 'dayjs/locale/id'
import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { timeout } from 'hono/timeout'
import { trimTrailingSlash } from 'hono/trailing-slash'
import { env } from './env'
import { timeoutException } from './exceptions'
import { corsMiddlewareOptions } from './lib/cors'

import { requestId } from 'hono/request-id'
import { logger } from './lib/logger'
import onError from './middlewares/error'
import onNotFound from './middlewares/not-found'
import authRoute from './routes/auth-route'
import docsRoute from './routes/docs-route'
import healthRoute from './routes/health-route'
import homeRoute from './routes/home-route'
import { AppEnv } from './types'
import { betterAuthMiddleware } from './middlewares/authentication'
import phoneRoute from './routes/phone-route'

dayjs.locale('id')

const app = new Hono<AppEnv>()

app.use(csrf({ origin: env.corsOrigins }))
app.use(corsMiddlewareOptions)
app.use(trimTrailingSlash())
app.use(requestId())
app.use(logger())
app.use(betterAuthMiddleware)
app.use(timeout(5 * 60 * 1000, timeoutException)) // 5 minutes

app.route('/', homeRoute)
app.route('/health', healthRoute)
app.route('/docs', docsRoute)
app.route('/auth', authRoute)
app.route('/phone', phoneRoute)

app.notFound(onNotFound)
app.onError(onError)

export default {
  port: env.port,
  fetch: app.fetch,
}
