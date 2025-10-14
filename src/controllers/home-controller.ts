import { ok } from '@/lib/response'
import { AppEnv } from '@/types'
import { Context } from 'hono'

export async function getWelcomeMessage(c: Context<AppEnv>) {
  return c.json(ok(null, 'Welcome to Quantum Sport API!'))
}
