import { DATETIME_FORMAT } from '@/constants'
import { healthCheckHandler } from '@/handlers/health.handler'
import jsonContent from '@/helpers/json-content'
import createMessageObjectSchema from '@/helpers/schema/create-message-object'
import { createRouter } from '@/lib/create-app'
import { createRoute } from '@hono/zod-openapi'
import dayjs from 'dayjs'
import status from 'http-status'

const healthRouteDoc = createRoute({
  path: '/health',
  method: 'get',
  summary: 'Health Check',
  description: 'Health check route',
  tags: ['General'],
  responses: {
    [status.OK]: jsonContent(
      createMessageObjectSchema(
        `Server is healthy at ${dayjs().format(DATETIME_FORMAT)}`,
        {
          up: true,
          ts: dayjs().format(DATETIME_FORMAT),
        },
      ),
      'Successful Response',
    ),
  },
})

export type healthRouteDoc = typeof healthRouteDoc

const healthRoute = createRouter().openapi(healthRouteDoc, healthCheckHandler)

export default healthRoute
