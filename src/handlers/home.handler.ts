import { ok } from '@/lib/response'
import { AppRouteHandler } from '@/types'

export const getWelcomeMessageHandler: AppRouteHandler = (c) => {
  return c.json(ok(null, 'Welcome to Quantum Sport API!'))
}
