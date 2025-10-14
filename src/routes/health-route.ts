import { getApiHealth } from '@/controllers/health-controller'
import { Hono } from 'hono'

const healthRoute = new Hono().get('/', getApiHealth)

export type AppType = typeof healthRoute
export default healthRoute
