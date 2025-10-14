import { getWelcomeMessage } from '@/controllers/home-controller'
import { Hono } from 'hono'

const homeRoute = new Hono().get('/', getWelcomeMessage)

export type AppType = typeof homeRoute
export default homeRoute
