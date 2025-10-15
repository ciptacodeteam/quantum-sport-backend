import dayjs from 'dayjs'
import 'dayjs/locale/id'
import duration from 'dayjs/plugin/duration'

import configureOpenAPI from './lib/configure-openapi'
import createApp from './lib/create-app'
import adminAuthRoute from './routes/admin/auth.route'
import adminHomeRoute from './routes/admin/home.route'
import authRoute from './routes/auth.route'
import healthRoute from './routes/health.route'
import homeRoute from './routes/home.route'
import phoneVerificationRoute from './routes/phone.route'
import { serveStatic } from '@hono/node-server/serve-static'

dayjs.extend(duration).locale('id')

const app = createApp()

app.use('/storage/*', serveStatic({ root: './' }))

// ADD NEW ROUTES HERE
const routes = [homeRoute, healthRoute, phoneVerificationRoute, authRoute]

// ADD NEW ADMIN ROUTES HERE
const adminRoutes = [adminHomeRoute, adminAuthRoute]

configureOpenAPI(app)

routes.forEach((route) => {
  app.route('/', route)
})

adminRoutes.forEach((route) => {
  app.route('/admin', route)
})

export default app
