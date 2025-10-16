import { healthCheckHandler } from '@/handlers/health.handler'
import { createRouter } from '@/lib/create-app'

const healthRoute = createRouter().get('/', healthCheckHandler)

export default healthRoute
