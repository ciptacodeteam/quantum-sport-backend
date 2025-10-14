import {
  sendPhoneVerificationOtp,
  verifyPhoneVerificationOtp,
} from '@/controllers/phone-controller'
import { phoneSchema, verifyOtpPayloadSchema } from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

const phoneRoute = new Hono()
  .post('/send-otp', zValidator('json', phoneSchema), sendPhoneVerificationOtp)
  .post(
    '/verify-otp',
    zValidator('json', verifyOtpPayloadSchema),
    verifyPhoneVerificationOtp,
  )

export type AppType = typeof phoneRoute
export default phoneRoute
