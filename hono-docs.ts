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
      appTypePath: 'src/routes/home-route.ts', // Path to your AppType export
      api: [
        {
          api: '/',
          method: 'get',
          description: 'Get API home information',
          summary: 'API Home',
        },
      ],
    },
    {
      name: 'Health Routes',
      apiPrefix: '/health', // This will be prepended to all `api` values below
      appTypePath: 'src/routes/health-route.ts', // Path to your AppType export
      api: [
        {
          api: '/',
          method: 'get',
          description: 'Get API health status',
          summary: 'API Health',
        },
      ],
    },
    {
      name: 'Docs Routes',
      apiPrefix: '/docs', // This will be prepended to all `api` values below
      appTypePath: 'src/routes/docs-route.ts', // Path to your AppType export
      api: [
        {
          api: '/',
          method: 'get',
          description: 'Get API documentation',
          summary: 'API Docs',
        },
        {
          api: '/open-api',
          method: 'get',
          description: 'Get OpenAPI specification in JSON format',
          summary: 'OpenAPI JSON',
        },
        {
          api: '/open-api/auth',
          method: 'get',
          description:
            'Get OpenAPI specification for authentication in JSON format',
          summary: 'OpenAPI Auth JSON',
        },
      ],
    },
  ],
})
