import {
  sendPhoneVerificationOtpHandler,
  verifyPhoneVerificationOtpHandler,
} from '@/handlers/phone.handler'

import { createRouter } from '@/lib/create-app'

const phoneVerificationRoute = createRouter()
  .basePath('/phone')
  .post('/send-otp', ...sendPhoneVerificationOtpHandler)
  .post('/verify-otp', ...verifyPhoneVerificationOtpHandler)

export default phoneVerificationRoute
