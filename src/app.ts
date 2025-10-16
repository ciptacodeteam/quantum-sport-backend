import dayjs from 'dayjs'
import 'dayjs/locale/id'
import duration from 'dayjs/plugin/duration'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'

import { serveStatic } from '@hono/node-server/serve-static'
import createApp from './lib/create-app'
import adminAuthRoute from './routes/admin/auth.route'
import adminHomeRoute from './routes/admin/home.route'
import adminInventoryRoute from './routes/admin/inventory.route'
import adminStaffRoute from './routes/admin/staff.route'
import authRoute from './routes/auth.route'
import healthRoute from './routes/health.route'
import homeRoute from './routes/home.route'
import phoneVerificationRoute from './routes/phone.route'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.locale('id')
dayjs.extend(duration)
dayjs.extend(isSameOrBefore)
dayjs.extend(customParseFormat)

const app = createApp()

app.use('/storage/*', serveStatic({ root: './src' }))

// ADD NEW ROUTES HERE
const routes = [homeRoute, healthRoute, phoneVerificationRoute, authRoute]

// ADD NEW ADMIN ROUTES HERE
const adminRoutes = [
  adminHomeRoute,
  adminAuthRoute,
  adminInventoryRoute,
  adminStaffRoute,
]

routes.forEach((route) => {
  app.route('/', route)
})

adminRoutes.forEach((route) => {
  app.route('/admin', route)
})

export default app
