import { auth } from '@/lib/auth'
import { Hono } from 'hono'

const authRoute = new Hono()

authRoute.on(['POST', 'GET'], '/*', (c) => auth.handler(c.req.raw))

export default authRoute
