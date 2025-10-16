import { welcomeMessageHandler } from '@/handlers/home.handler'
import { createRouter } from '@/lib/create-app'

const homeRoute = createRouter().get('/', ...welcomeMessageHandler)

export default homeRoute
