import { User } from 'generated/prisma'
import type { Context, Handler, MiddlewareHandler } from 'hono'
import type { PinoLogger } from 'hono-pino'

type AppVariables = {
  user: User | null
  logger: PinoLogger
}

type AppEnv = {
  Variables: AppVariables
}

// Quality-of-life local aliases
type AppContext = Context<AppEnv>
type AppHandler = Handler<AppEnv>
type AppMiddleware = MiddlewareHandler<AppEnv>
