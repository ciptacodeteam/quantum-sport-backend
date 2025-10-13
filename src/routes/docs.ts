// src/routes/docs.ts
import { Hono } from 'hono'
import { Scalar } from '@scalar/hono-api-reference'
import fs from 'node:fs/promises'
import path from 'node:path'

// Refer to https://hono.dev/examples/hono-docs
const docsRoute = new Hono()
  .get(
    '/',
    Scalar({
      url: '/docs/open-api',
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
