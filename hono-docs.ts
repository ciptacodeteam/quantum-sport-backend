import { defineConfig } from '@rcmade/hono-docs'
import { env } from './src/env'

export default defineConfig({
  tsConfigPath: './tsconfig.json',
  openApi: {
    openapi: '3.1.0',
    info: { title: 'Quantum Sport API', version: '1.0.0' },
    servers: [{ url: `${env.baseUrl}` }],
  },
  outputs: {
    openApiJson: './openapi/openapi.json',
  },
  apis: [
    {
      name: 'General Routes',
      apiPrefix: '/', // This will be prepended to all `api` values below
      appTypePath: 'src/routes/home.ts', // Path to your AppType export
      api: [
        {
          api: '/',
          method: 'get',
          description: 'Get API home information',
          summary: 'API Home',
        },
        {
          api: '/health',
          method: 'get',
          description: 'Get health information',
          summary: 'Health Check',
        },
      ],
    },
  ],
})
