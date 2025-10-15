import { OpenAPIHono, RouteConfig, RouteHandler } from '@hono/zod-openapi'
import { Context } from 'hono'
import type { PinoLogger } from 'hono-pino'

type UserTokenPayload = {
  id: string
  phone: string
  role: string
}

type AppBinding = {
  Variables: {
    user: UserTokenPayload | null
    logger: PinoLogger
  }
}

type AppOpenApi = OpenAPIHono<AppBinding>
type AppRouteHandler<R extends RouteConfig> = RouteHandler<R, AppBinding>
type AppMiddleware = (
  c: Context<AppBinding>,
  next: () => Promise<void>,
) => Promise<void>
