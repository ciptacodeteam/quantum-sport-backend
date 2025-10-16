import {
  sendPhoneVerificationOtpHandler,
  verifyPhoneVerificationOtpHandler,
} from '@/handlers/phone.handler'
import { validateHook } from '@/helpers/validate-hook'

import { createRouter } from '@/lib/create-app'
import { phoneSchema, verifyOtpSchema } from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'

const phoneVerificationRoute = createRouter()
  .basePath('/phone')
  .post(
    '/send-otp',
    zValidator('json', phoneSchema, validateHook),
    sendPhoneVerificationOtpHandler,
  )
  .post(
    '/verify-otp',
    zValidator('json', verifyOtpSchema, validateHook),
    verifyPhoneVerificationOtpHandler,
  )

export default phoneVerificationRoute
