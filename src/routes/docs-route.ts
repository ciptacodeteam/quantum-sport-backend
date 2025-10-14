// src/routes/docs.ts
import { Hono } from 'hono'
import { Scalar } from '@scalar/hono-api-reference'
import fs from 'node:fs/promises'
import path from 'node:path'
import { auth } from '@/lib/auth'

// Refer to https://hono.dev/examples/hono-docs
const docsRoute = new Hono()
  .get(
    '/',
    Scalar({
      pageTitle: 'API Documentation',
      sources: [
        {
          title: 'API Documentation',
          url: '/docs/open-api',
        },
        { url: '/docs/open-api/auth', title: 'Authentication' },
      ],
      theme: 'kepler',
      layout: 'modern',
      defaultHttpClient: { targetKey: 'js', clientKey: 'axios' },
    }),
  )
  .get('/open-api', async (c) => {
    const raw = await fs.readFile(
      path.join(process.cwd(), './openapi/openapi.json'),
      'utf-8',
    )
    return c.json(JSON.parse(raw))
  })
  .get('/open-api/auth', async (c) => {
    const openAPISchema = await auth.api.generateOpenAPISchema()
    return c.json(openAPISchema)
  })

export type AppType = typeof docsRoute
export default docsRoute
