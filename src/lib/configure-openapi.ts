import type { AppOpenApi } from '@/types'

import packageJson from '../../package.json' assert { type: 'json' }
import { Scalar } from '@scalar/hono-api-reference'

import type { Hook } from '@hono/zod-openapi'
import status from 'http-status'

export const defaultHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    return c.json(
      {
        success: result.success,
        message: 'Validation Error',
        error: {
          name: result.error.name,
          issues: result.error.issues,
        },
      },
      status.UNPROCESSABLE_ENTITY,
    )
  }
}

export default function configureOpenAPI(app: AppOpenApi) {
  app.doc('/docs/open-api', {
    openapi: '3.0.0',
    info: {
      title: 'Quantum Sport API',
      version: packageJson.version,
      description: 'API documentation for Quantum Sport backend.',
    },
  })

  app.get(
    '/docs',
    Scalar({
      pageTitle: 'API Documentation',
      sources: [
        {
          title: 'API Documentation',
          url: '/docs/open-api',
        },
      ],
      theme: 'kepler',
      layout: 'modern',
      defaultHttpClient: { targetKey: 'js', clientKey: 'axios' },
    }),
  )
}
