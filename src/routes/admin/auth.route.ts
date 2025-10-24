import {
  changePasswordAdminHandler,
  checkAdminAccountHandler,
  getAdminProfileHandler,
  loginAdminHandler,
  logoutAdminHandler,
  refreshTokenAdminHandler,
  registerAdminHandler,
  updateAdminProfileHandler,
} from '@/handlers/admin/auth.handler'
import { createRouter } from '@/lib/create-app'

const adminAuthRoute = createRouter()
  .basePath('/auth')
  .post('/login', ...loginAdminHandler)
  .post('/refresh-token', ...refreshTokenAdminHandler)
  .get('/check-account', ...checkAdminAccountHandler)
  .post('/register', ...registerAdminHandler)
  .post('/logout', ...logoutAdminHandler)
  .get('/profile', ...getAdminProfileHandler)
  .post('/profile', ...updateAdminProfileHandler)
  .post('/change-password', ...changePasswordAdminHandler)

export default adminAuthRoute
