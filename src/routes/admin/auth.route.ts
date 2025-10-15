import {
  adminLoginHandler,
  adminLogoutHandler,
  adminProfileHandler,
  adminRegisterHandler,
  adminUpdateProfileHandler,
} from '@/handlers/admin/auth.handler'
import jsonContent from '@/helpers/json-content'
import jsonContentRequired from '@/helpers/json-content-required'
import multiformContent from '@/helpers/multiform-content'
import createErrorSchema from '@/helpers/schema/create-error-schema'
import createMessageObjectSchema from '@/helpers/schema/create-message-object'
import { createRouter } from '@/lib/create-app'
import {
  adminProfileSchema,
  adminRegisterSchema,
  authTokenCookieSchema,
  loginWithEmailSchema,
} from '@/lib/validation'
import { requireAdminAuth } from '@/middlewares/auth'
import { createRoute } from '@hono/zod-openapi'
import dayjs from 'dayjs'
import status from 'http-status'

export const adminRegisterRouteDoc = createRoute({
  path: '/register',
  method: 'post',
  summary: 'Register Admin',
  description: 'Register the first admin user',
  tags: ['Admin Authentication'],
  request: {
    body: jsonContentRequired(adminRegisterSchema, 'Register Admin payload'),
  },
  responses: {
    [status.CREATED]: jsonContent(
      createMessageObjectSchema('Admin registered successfully'),
      'Successful Response',
    ),
    [status.BAD_REQUEST]: jsonContent(
      createErrorSchema(adminRegisterSchema),
      'Bad Request Response',
    ),
    [status.CONFLICT]: jsonContent(
      createMessageObjectSchema('Conflict', null, 'Detailed error message'),
      'Conflict Response',
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

export type AdminRegisterAdminRouteDoc = typeof adminRegisterRouteDoc

export const adminLoginRouteDoc = createRoute({
  path: '/login',
  method: 'post',
  summary: 'Login with Email',
  description: 'Login a user with their email and password',
  tags: ['Admin Authentication'],
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

export type AdminLoginRouteDoc = typeof adminLoginRouteDoc

export const adminLogoutRouteDoc = createRoute({
  path: '/logout',
  method: 'post',
  summary: 'Admin Logout',
  description: 'Logout the currently authenticated admin user',
  tags: ['Admin Authentication'],
  request: {
    cookies: authTokenCookieSchema,
  },
  middleware: [requireAdminAuth],
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

export type AdminLogoutRouteDoc = typeof adminLogoutRouteDoc

export const adminProfileRouteDoc = createRoute({
  path: '/profile',
  method: 'get',
  summary: 'Get Admin Profile',
  description: 'Retrieve the admin profile information',
  tags: ['Admin Authentication'],
  middleware: [requireAdminAuth],
  request: {
    cookies: authTokenCookieSchema,
  },
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('Admin profile retrieved successfully', {
        id: 'admin-id',
        name: 'John Doe',
        phone: '+621234567890',
        email: 'john.doe@example.com',
        image: 'https://example.com/profile.jpg',
        createdAt: dayjs().toISOString(),
        updatedAt: dayjs().toISOString(),
        isActive: true,
        joinedAt: dayjs().toISOString(),
        role: 'admin',
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

export type AdminProfileRouteDoc = typeof adminProfileRouteDoc

const adminUpdateProfileRouteDoc = createRoute({
  path: '/profile',
  method: 'post',
  summary: 'Update Admin Profile',
  description: 'Update the admin profile information',
  tags: ['Admin Authentication'],
  middleware: [requireAdminAuth],
  request: {
    cookies: authTokenCookieSchema,
    body: multiformContent(adminProfileSchema, 'Update Admin Profile payload'),
  },
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('Admin profile updated successfully'),
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
    [status.CONFLICT]: jsonContent(
      createMessageObjectSchema('Conflict', null, 'Detailed error message'),
      'Conflict Response',
    ),
    [status.BAD_REQUEST]: jsonContent(
      createErrorSchema(adminProfileSchema),
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

export type AdminUpdateProfileRouteDoc = typeof adminUpdateProfileRouteDoc

const adminAuthRoute = createRouter()
  .basePath('/auth')
  .openapi(adminLoginRouteDoc, adminLoginHandler)
  .openapi(adminRegisterRouteDoc, adminRegisterHandler)
  .openapi(adminLogoutRouteDoc, adminLogoutHandler)
  .openapi(adminProfileRouteDoc, adminProfileHandler)
  .openapi(adminUpdateProfileRouteDoc, adminUpdateProfileHandler)

export default adminAuthRoute
