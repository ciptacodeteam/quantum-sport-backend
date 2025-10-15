import { OpenAPIHono, RouteConfig, RouteHandler } from '@hono/zod-openapi'
import { User } from 'generated/prisma'
import { Context } from 'hono'
import type { PinoLogger } from 'hono-pino'

type AppBinding = {
  Variables: {
    user: User | null
    logger: PinoLogger
  }
}

type AppOpenApi = OpenAPIHono<AppBinding>
type AppRouteHandler<R extends RouteConfig> = RouteHandler<R, AppBinding>
type AppMiddleware = (
  c: Context<AppBinding>,
  next: () => Promise<void>,
) => Promise<void>
