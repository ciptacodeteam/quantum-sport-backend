import { ok } from '@/lib/response'
import { HomeRoute } from '@/routes/home.route'
import { AppRouteHandler } from '@/types'

export const getWelcomeMessage: AppRouteHandler<HomeRoute> = (c) => {
  return c.json(ok(null, 'Welcome to Quantum Sport API!'))
}
