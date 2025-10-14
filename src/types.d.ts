import type { Context } from 'hono'
import type { Handler, MiddlewareHandler } from 'hono'
import { auth } from '../lib/auth' // wherever you create your Better Auth instance
import type { PinoLogger } from 'hono-pino'

type AppVariables = {
  user: typeof auth.$Infer.Session.user | null
  session: typeof auth.$Infer.Session.session | null
  logger: PinoLogger
}

type AppEnv = {
  Variables: AppVariables
}

// Quality-of-life local aliases
type AppContext = Context<AppEnv>
type AppHandler = Handler<AppEnv>
type AppMiddleware = MiddlewareHandler<AppEnv>
