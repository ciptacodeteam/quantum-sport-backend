import { serve } from '@hono/node-server'
import app from './src/app'
import { env } from './src/env'

const port = Number(env.port) || 3000

serve(
  {
    fetch: app.fetch,
    port: port,
  },
  (info) => {
    console.log(`🚀 Server is running on port http://localhost:${info.port}`)
  },
)
