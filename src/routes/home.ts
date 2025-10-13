import { getApiHealth } from '@/controllers/health-controller'
import { getWelcomeMessage } from '@/controllers/home-controller'
import { Hono } from 'hono'

const homeRoute = new Hono()
  .get('/', getWelcomeMessage)
  .get('/health', getApiHealth)

export type AppType = typeof homeRoute
export default homeRoute
