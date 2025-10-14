import { env } from '@/env'
import { cors } from 'hono/cors'

const getOrigin = (origin: string) => {
  if (env.corsOrigins.length === 0) return '*'
  return env.corsOrigins.includes(origin) ? origin : null
}

export const corsMiddlewareOptions = cors({
  origin: getOrigin,
  allowHeaders: ['Content-Type', 'Upgrade-Insecure-Requests', 'Authorization'],
  allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
})
