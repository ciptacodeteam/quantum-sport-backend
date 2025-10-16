import { healthCheckHandler } from '@/handlers/health.handler'
import { createRouter } from '@/lib/create-app'

const healthRoute = createRouter().get('/health', ...healthCheckHandler)

export default healthRoute
