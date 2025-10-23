import {
  forgotPasswordHandler,
  getProfileHandler,
  loginHandler,
  loginWithEmailHandler,
  logoutHandler,
  refreshTokenHandler,
  registerHandler,
  resetPasswordHandler,
  sendLoginOtpHandler,
} from '@/handlers/auth.handler'

import { createRouter } from '@/lib/create-app'

const authRoute = createRouter()
  .basePath('/auth')
  .post('/send-login-otp', ...sendLoginOtpHandler)
  .post('/login', ...loginHandler)
  .post('/register', ...registerHandler)
  .post('/login/email', ...loginWithEmailHandler)
  .post('/logout', ...logoutHandler)
  .post('/refresh-token', ...refreshTokenHandler)
  .post('/forgot-password', ...forgotPasswordHandler)
  .post('/reset-password', ...resetPasswordHandler)
  .get('/profile', getProfileHandler)

export default authRoute
