import { getWelcomeMessage } from '@/handlers/home.controller'
import jsonContent from '@/helpers/json-content'
import createMessageObjectSchema from '@/helpers/schema/create-message-object'
import { createRouter } from '@/lib/create-app'
import { createRoute } from '@hono/zod-openapi'
import status from 'http-status'

const homeRoute = createRoute({
  path: '/',
  method: 'get',
  summary: 'Home',
  description: 'Home route',
  tags: ['General'],
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema('Welcome to Quantum Sport API!'),
      'Successful Response',
    ),
  },
})

export type HomeRoute = typeof homeRoute

const router = createRouter().openapi(homeRoute, getWelcomeMessage)

export default router
