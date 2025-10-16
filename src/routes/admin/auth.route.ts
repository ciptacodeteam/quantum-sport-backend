import {
  adminLoginHandler,
  adminLogoutHandler,
  adminProfileHandler,
  adminRegisterHandler,
  adminUpdateProfileHandler,
} from '@/handlers/admin/auth.handler'
import { validateHook } from '@/helpers/validate-hook'
import { createRouter } from '@/lib/create-app'
import {
  loginSchema,
  registerAdminSchema,
  updateAdminProfileSchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'

const adminAuthRoute = createRouter()
  .basePath('/auth')
  .post(
    '/login',
    zValidator('json', loginSchema, validateHook),
    adminLoginHandler,
  )
  .post(
    '/register',
    zValidator('json', registerAdminSchema, validateHook),
    adminRegisterHandler,
  )
  .post('/logout', adminLogoutHandler)
  .get('/profile', adminProfileHandler)
  .post(
    '/profile',
    zValidator('form', updateAdminProfileSchema, validateHook),
    adminUpdateProfileHandler,
  )

export default adminAuthRoute
