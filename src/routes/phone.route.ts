import {
  sendPhoneVerificationOtpHandler,
  verifyPhoneVerificationOtpHandler,
} from '@/handlers/phone.handler'

import { createRouter } from '@/lib/create-app'

const phoneVerificationRoute = createRouter()
  .basePath('/phone')
  .post('/send-otp', ...sendPhoneVerificationOtpHandler) // USE FOR REGISTER ONLY
  .post('/verify-otp', ...verifyPhoneVerificationOtpHandler) // GLOBAL USE

export default phoneVerificationRoute
