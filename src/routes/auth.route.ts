import {
  forgotPasswordHandler,
  getProfileHandler,
  loginHandler,
  loginWithEmailHandler,
  logoutHandler,
  refreshTokenHandler,
  registerHandler,
  resetPasswordHandler,
} from '@/handlers/auth.handler'
import {
  authTokenCookieSchema,
  forgotPasswordSchema,
  loginSchema,
  loginWithEmailSchema,
  registerSchema,
  resetPasswordSchema,
} from '@/lib/validation'
import { requireAuth } from '@/middlewares/auth'

import jsonContent from '@/helpers/json-content'
import jsonContentRequired from '@/helpers/json-content-required'
import createErrorSchema from '@/helpers/schema/create-error-schema'
import createMessageObjectSchema from '@/helpers/schema/create-message-object'
import { createRouter } from '@/lib/create-app'
import { createRoute } from '@hono/zod-openapi'
import dayjs from 'dayjs'
import status from 'http-status'

const loginRouteDoc = createRoute({
  path: '/login',
  method: 'post',
  summary: 'Phone Login',
  description: 'Login route using phone number after OTP verification',
  tags: ['Authentication'],
  request: {
    body: jsonContentRequired(loginSchema, 'Login payload'),
  },
  responses: {
    [status.OK]: {
      ...jsonContent(
        createMessageObjectSchema('Login successful'),
        'Successful Response',
      ),
      headers: {
        'Set-Cookie': {
          description: 'Set authentication cookies (token and refreshToken)',
          schema: {
            type: 'string',
            example:
              'token=jwt-token; HttpOnly; Path=/; Max-Age=3600; SameSite=Strict, refreshToken=token-value; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict',
          },
        },
      },
    },
    [status.BAD_REQUEST]: jsonContent(
      createErrorSchema(loginSchema),
      'Bad Request Response',
    ),
    [status.UNAUTHORIZED]: jsonContent(
      createMessageObjectSchema('Unauthorized', null, 'Detailed error message'),
      'Unauthorized Response',
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

export type LoginRouteDoc = typeof loginRouteDoc

const registerRouteDoc = createRoute({
  path: '/register',
  method: 'post',
  summary: 'User Registration',
  description: 'Register a new user with phone number after OTP verification',
  tags: ['Authentication'],
  request: {
    body: jsonContentRequired(registerSchema, 'Register payload'),
  },
  responses: {
    [status.CREATED]: {
      ...jsonContent(
        createMessageObjectSchema('User registered successfully', {
          token: 'jwt-token',
        }),
        'Successful Response',
      ),
      headers: {
        'Set-Cookie': {
          description: 'Set authentication cookies (token and refreshToken)',
          schema: {
            type: 'string',
            example:
              'token=jwt-token; HttpOnly; Path=/; Max-Age=3600; SameSite=Strict, refreshToken=token-value; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict',
          },
        },
      },
    },
    [status.BAD_REQUEST]: jsonContent(
      createErrorSchema(registerSchema),
      'Bad Request Response',
    ),
    [status.UNAUTHORIZED]: jsonContent(
      createMessageObjectSchema('Unauthorized', null, 'Detailed error message'),
      'Unauthorized Response',
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

export type RegisterRouteDoc = typeof registerRouteDoc

const logoutRouteDoc = createRoute({
  path: '/logout',
  method: 'post',
  summary: 'User Logout',
  description: 'Logout a user',
  tags: ['Authentication'],
  request: {
    cookies: authTokenCookieSchema,
  },
  middleware: [requireAuth],
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('User logged out successfully'),
      'Successful Response',
    ),
    [status.UNAUTHORIZED]: jsonContent(
      createMessageObjectSchema('Unauthorized', null, 'Detailed error message'),
      'Unauthorized Response',
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

export type LogoutRouteDoc = typeof logoutRouteDoc

const refreshTokenRouteDoc = createRoute({
  path: '/refresh',
  method: 'post',
  summary: 'Refresh Token',
  description: 'Refresh the access token using the refresh token',
  tags: ['Authentication'],
  request: {
    cookies: authTokenCookieSchema,
  },
  middleware: [requireAuth],
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('Token refreshed successfully', {
        accessToken: 'new-access-token',
      }),
      'Successful Response',
    ),
    [status.UNAUTHORIZED]: jsonContent(
      createMessageObjectSchema('Unauthorized', null, 'Detailed error message'),
      'Unauthorized Response',
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

export type RefreshTokenRouteDoc = typeof refreshTokenRouteDoc

const forgotPasswordRouteDoc = createRoute({
  path: '/forgot-password',
  method: 'post',
  summary: 'Forgot Password',
  description: 'Request a password reset link',
  tags: ['Authentication'],
  request: {
    body: jsonContentRequired(forgotPasswordSchema, 'Forgot Password payload'),
  },
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('OTP sent successfully', {
        phone: '+621234567890',
        requestId: 'unique-request-id',
      }),
      'Successful Response',
    ),
    [status.BAD_REQUEST]: jsonContent(
      createErrorSchema(forgotPasswordSchema),
      'Bad Request Response',
    ),
    [status.UNAUTHORIZED]: jsonContent(
      createMessageObjectSchema('Unauthorized', null, 'Detailed error message'),
      'Unauthorized Response',
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

export type ForgotPasswordRouteDoc = typeof forgotPasswordRouteDoc

const resetPasswordRouteDoc = createRoute({
  path: '/reset-password',
  method: 'post',
  summary: 'Reset Password',
  description: 'Reset the user password',
  tags: ['Authentication'],
  request: {
    body: jsonContentRequired(resetPasswordSchema, 'Reset Password payload'),
  },
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('Password reset successfully'),
      'Successful Response',
    ),
    [status.BAD_REQUEST]: jsonContent(
      createErrorSchema(resetPasswordSchema),
      'Bad Request Response',
    ),
    [status.UNAUTHORIZED]: jsonContent(
      createMessageObjectSchema('Unauthorized', null, 'Detailed error message'),
      'Unauthorized Response',
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

export type ResetPasswordRouteDoc = typeof resetPasswordRouteDoc

const loginWithEmailRouteDoc = createRoute({
  path: '/login/email',
  method: 'post',
  summary: 'Login with Email',
  description: 'Login a user with their email and password',
  tags: ['Authentication'],
  request: {
    body: jsonContentRequired(loginWithEmailSchema, 'Login with Email payload'),
  },
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('Login successful'),
      'Successful Response',
    ),
    [status.UNAUTHORIZED]: jsonContent(
      createMessageObjectSchema('Unauthorized', null, 'Detailed error message'),
      'Unauthorized Response',
    ),
    [status.BAD_REQUEST]: jsonContent(
      createErrorSchema(loginWithEmailSchema),
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

export type LoginWithEmailRouteDoc = typeof loginWithEmailRouteDoc

const profileRouteDoc = createRoute({
  path: '/profile',
  method: 'get',
  summary: 'Get User Profile',
  description: 'Retrieve the user profile information',
  tags: ['Authentication'],
  middleware: [requireAuth],
  request: {
    cookies: authTokenCookieSchema,
  },
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('User profile retrieved successfully', {
        id: 'user-id',
        name: 'John Doe',
        phone: '+621234567890',
        email: 'john.doe@example.com',
        image: 'https://example.com/profile.jpg',
        createdAt: dayjs().toISOString(),
        updatedAt: dayjs().toISOString(),
        banned: false,
        banExpires: null,
        banReason: null,
        googleId: null,
        emailVerified: true,
        phoneVerified: true,
      }),
      'Successful Response',
    ),
    [status.UNAUTHORIZED]: jsonContent(
      createMessageObjectSchema('Unauthorized', null, 'Detailed error message'),
      'Unauthorized Response',
    ),
    [status.FORBIDDEN]: jsonContent(
      createMessageObjectSchema('Forbidden', null, 'Detailed error message'),
      'Forbidden Response',
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

export type ProfileRouteDoc = typeof profileRouteDoc

const authRoute = createRouter()
  .basePath('/auth')
  .openapi(loginRouteDoc, loginHandler)
  .openapi(registerRouteDoc, registerHandler)
  .openapi(loginWithEmailRouteDoc, loginWithEmailHandler)
  .openapi(logoutRouteDoc, logoutHandler)
  .openapi(refreshTokenRouteDoc, refreshTokenHandler)
  .openapi(forgotPasswordRouteDoc, forgotPasswordHandler)
  .openapi(resetPasswordRouteDoc, resetPasswordHandler)
  .openapi(profileRouteDoc, getProfileHandler)

export default authRoute
