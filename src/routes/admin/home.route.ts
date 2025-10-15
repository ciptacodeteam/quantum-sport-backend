import { getWelcomeMessageHandler } from '@/handlers/home.handler'
import jsonContent from '@/helpers/json-content'
import createMessageObjectSchema from '@/helpers/schema/create-message-object'
import { createRouter } from '@/lib/create-app'
import { createRoute } from '@hono/zod-openapi'
import status from 'http-status'

const adminHomeRouteDoc = createRoute({
  path: '/',
  method: 'get',
  summary: 'Admin Home Route',
  description: 'Get a welcome message for the Quantum Sport API admin.',
  tags: ['Admin General'],
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('Welcome to Quantum Sport API!'),
      'Successful Response',
    ),
  },
})

export type AdminHomeRouteDoc = typeof adminHomeRouteDoc

const adminHomeRoute = createRouter().openapi(
  adminHomeRouteDoc,
  getWelcomeMessageHandler,
)

export default adminHomeRoute
