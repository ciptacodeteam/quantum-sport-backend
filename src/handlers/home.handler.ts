import { factory } from '@/lib/create-app'
import { ok } from '@/lib/response'

export const welcomeMessageHandler = factory.createHandlers((c) => {
  return c.json(ok(null, 'Welcome to Quantum Sport API!'))
})
