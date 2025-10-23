import {
  checkAccountHandler,
  forgotPasswordHandler,
  getProfileHandler,
  loginHandler,
  loginWithEmailHandler,
  logoutHandler,
  refreshTokenHandler,
  registerHandler,
  resetPasswordHandler,
} from '@/handlers/auth.handler'

import { createRouter } from '@/lib/create-app'

const authRoute = createRouter()
  .basePath('/auth')
  .post('/check-account', ...checkAccountHandler) // USE FOR CHECKING ACCOUNT EXISTS
  .post('/login', ...loginHandler)
  .post('/register', ...registerHandler)
  .post('/login/email', ...loginWithEmailHandler)
  .post('/logout', ...logoutHandler)
  .post('/refresh-token', ...refreshTokenHandler)
  .post('/forgot-password', ...forgotPasswordHandler)
  .post('/reset-password', ...resetPasswordHandler)
  .get('/profile', getProfileHandler)

export default authRoute
