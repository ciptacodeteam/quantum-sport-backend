// src/routes/docs.ts
import { Scalar } from '@scalar/hono-api-reference'
import { Hono } from 'hono'
import fs from 'node:fs/promises'
import path from 'node:path'

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

export type AppType = typeof docsRoute
export default docsRoute
