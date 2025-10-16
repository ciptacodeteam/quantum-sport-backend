import { getWelcomeMessageHandler } from '@/handlers/home.handler'
import { createRouter } from '@/lib/create-app'

const homeRoute = createRouter().get('/', getWelcomeMessageHandler)

export default homeRoute
