import {
  getAdminProfileHandler,
  loginAdminHandler,
  logoutAdminHandler,
  registerAdminHandler,
  updateAdminProfileHandler,
} from '@/handlers/admin/auth.handler'
import { createRouter } from '@/lib/create-app'

const adminAuthRoute = createRouter()
  .basePath('/auth')
  .post('/login', ...loginAdminHandler)
  .post('/register', ...registerAdminHandler)
  .post('/logout', ...logoutAdminHandler)
  .get('/profile', ...getAdminProfileHandler)
  .post('/profile', ...updateAdminProfileHandler)

export default adminAuthRoute
