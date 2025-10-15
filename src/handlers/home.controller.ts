import { ok } from '@/lib/response'
import { HomeRouteDoc } from '@/routes/home.route'
import { AppRouteHandler } from '@/types'

export const getWelcomeMessage: AppRouteHandler<HomeRouteDoc> = (c) => {
  return c.json(ok(null, 'Welcome to Quantum Sport API!'))
}
