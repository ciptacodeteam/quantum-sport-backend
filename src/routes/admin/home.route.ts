import { welcomeMessageHandler } from '@/handlers/home.handler'
import { createRouter } from '@/lib/create-app'

const adminHomeRoute = createRouter().get('/', ...welcomeMessageHandler)

export default adminHomeRoute
