import { ok } from '@/lib/response'
import { Context } from 'hono'
import status from 'http-status'

export async function getWelcomeMessage(c: Context) {
  return c.json(ok(null, 'Welcome to Quantum Sport API!'), status.OK)
}
