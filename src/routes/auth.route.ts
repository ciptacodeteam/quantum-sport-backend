import {
  changeUserPasswordHandler,
  checkAccountHandler,
  forgotPasswordHandler,
  getProfileHandler,
  loginHandler,
  loginWithEmailHandler,
  logoutHandler,
  refreshTokenHandler,
  registerHandler,
  requestEmailChangeHandler,
  resetPasswordHandler,
  verifyResetPasswordOtpHandler,
  verifyEmailChangeHandler,
  verifyUserPasswordHandler,
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
  .post('/verify-reset-otp', ...verifyResetPasswordOtpHandler)
  .get('/profile', getProfileHandler)
  .post('/email/request-change', ...requestEmailChangeHandler)
  .post('/email/verify-change', ...verifyEmailChangeHandler)
  .post('/verify-password', ...verifyUserPasswordHandler)
  .post('/change-password', ...changeUserPasswordHandler)

export default authRoute
