import {
  loginHandler,
  logoutHandler,
  refreshTokenHandler,
  registerHandler,
} from '@/handlers/auth-controller'
import { loginSchema, registerSchema } from '@/lib/validation'
import { requireAuth } from '@/middlewares/authentication'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

const authRoute = new Hono()
  .post('/login', zValidator('json', loginSchema), loginHandler)
  .post('/register', zValidator('json', registerSchema), registerHandler)
  .post('/logout', requireAuth, logoutHandler)
  .post('/refresh', requireAuth, refreshTokenHandler)

export type AppType = typeof authRoute
export default authRoute
