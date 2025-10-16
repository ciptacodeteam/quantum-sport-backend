import { getWelcomeMessageHandler } from '@/handlers/home.handler'
import { createRouter } from '@/lib/create-app'

const adminHomeRoute = createRouter().get('/', getWelcomeMessageHandler)

export default adminHomeRoute
