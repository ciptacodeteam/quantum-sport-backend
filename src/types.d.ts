import { OpenAPIHono, RouteConfig, RouteHandler } from '@hono/zod-openapi'
import { User } from 'generated/prisma'
import type { PinoLogger } from 'hono-pino'

type AppBinding = {
  Variables: {
    user: User | null
    logger: PinoLogger
  }
}

type AppOpenApi = OpenAPIHono<AppBinding>
type AppRouteHandler<R extends RouteConfig> = RouteHandler<R, AppBinding>
