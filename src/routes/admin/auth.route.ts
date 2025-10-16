import {
  getAdminProfileHandler,
  loginAdminHandler,
  logoutAdminHandler,
  registerAdminHandler,
  updateAdminProfileHandler,
} from '@/handlers/admin/auth.handler'
import { validateHook } from '@/helpers/validate-hook'
import { createRouter } from '@/lib/create-app'
import { registerAdminSchema } from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'

const adminAuthRoute = createRouter()
  .basePath('/auth')
  .post('/login', ...loginAdminHandler)
  .post(
    '/register',
    zValidator('json', registerAdminSchema, validateHook),
    ...registerAdminHandler,
  )
  .post('/logout', ...logoutAdminHandler)
  .get('/profile', ...getAdminProfileHandler)
  .post('/profile', ...updateAdminProfileHandler)

export default adminAuthRoute
