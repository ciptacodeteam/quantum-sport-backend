import {
  sendPhoneVerificationOtp,
  verifyPhoneVerificationOtp,
} from '@/handlers/phone.handler'
import { phoneSchema, verifyOtpPayloadSchema } from '@/lib/validation'

import jsonContent from '@/helpers/json-content'
import jsonContentRequired from '@/helpers/json-content-required'
import createErrorSchema from '@/helpers/schema/create-error-schema'
import createMessageObjectSchema from '@/helpers/schema/create-message-object'
import { createRouter } from '@/lib/create-app'
import { createRoute } from '@hono/zod-openapi'
import status from 'http-status'

const sendPhoneVerificationOtpRouteDoc = createRoute({
  path: '/send-otp',
  method: 'post',
  summary: 'Send Phone Verification OTP',
  description: 'Send Phone Verification OTP route',
  tags: ['Verification'],
  request: {
    body: jsonContentRequired(phoneSchema, 'Phone number payload'),
  },
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('OTP sent successfully', {
        phone: '+6281234567890',
        requestId: 'abc123xyz',
      }),
      'Successful Response',
    ),
    [status.BAD_REQUEST]: jsonContent(
      createErrorSchema(phoneSchema),
      'Bad Request Response',
    ),
    [status.INTERNAL_SERVER_ERROR]: jsonContent(
      createMessageObjectSchema(
        'Internal Server Error',
        null,
        'Detailed error message',
      ),
      'Internal Server Error Response',
    ),
  },
})

export type SendPhoneVerificationOtpRouteDoc =
  typeof sendPhoneVerificationOtpRouteDoc

const verifyPhoneOtpRouteDoc = createRoute({
  path: '/verify-otp',
  method: 'post',
  summary: 'Verify Phone OTP',
  description: 'Verify Phone OTP route',
  tags: ['Verification'],
  request: {
    body: jsonContent(verifyOtpPayloadSchema, 'Verify OTP payload'),
  },
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('Phone number verified successfully'),
      'Successful Response',
    ),
    [status.BAD_REQUEST]: jsonContent(
      createErrorSchema(verifyOtpPayloadSchema),
      'Bad Request Response',
    ),
    [status.INTERNAL_SERVER_ERROR]: jsonContent(
      createMessageObjectSchema(
        'Internal Server Error',
        null,
        'Detailed error message',
      ),
      'Internal Server Error Response',
    ),
  },
})

export type VerifyPhoneOtpRouteDoc = typeof verifyPhoneOtpRouteDoc

const phoneVerificationRoute = createRouter()
  .openapi(sendPhoneVerificationOtpRouteDoc, sendPhoneVerificationOtp)
  .openapi(verifyPhoneOtpRouteDoc, verifyPhoneVerificationOtp)

export default phoneVerificationRoute
