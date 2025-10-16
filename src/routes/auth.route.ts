import {
  forgotPasswordHandler,
  getProfileHandler,
  loginHandler,
  loginWithEmailHandler,
  logoutHandler,
  refreshTokenHandler,
  registerHandler,
  resetPasswordHandler,
} from '@/handlers/auth.handler'
import {
  forgotPasswordSchema,
  loginSchema,
  loginWithEmailSchema,
  registerSchema,
  resetPasswordSchema,
} from '@/lib/validation'

import { validateHook } from '@/helpers/validate-hook'
import { createRouter } from '@/lib/create-app'
import { zValidator } from '@hono/zod-validator'

const authRoute = createRouter()
  .basePath('/auth')
  .post('/login', zValidator('json', loginSchema, validateHook), loginHandler)
  .post(
    '/register',
    zValidator('json', registerSchema, validateHook),
    registerHandler,
  )
  .post(
    '/login/email',
    zValidator('json', loginWithEmailSchema, validateHook),
    loginWithEmailHandler,
  )
  .post('/logout', logoutHandler)
  .post('/refresh-token', refreshTokenHandler)
  .post(
    '/forgot-password',
    zValidator('json', forgotPasswordSchema, validateHook),
    forgotPasswordHandler,
  )
  .post(
    '/reset-password',
    zValidator('json', resetPasswordSchema, validateHook),
    resetPasswordHandler,
  )
  .get('/profile', getProfileHandler)

export default authRoute
