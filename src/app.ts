import dayjs from 'dayjs'
import 'dayjs/locale/id'
import duration from 'dayjs/plugin/duration'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

import { serveStatic } from '@hono/node-server/serve-static'
import { JAKARTA_TZ } from './config'
import createApp from './lib/create-app'
import adminAuthRoute from './routes/admin/auth.route'
import adminHomeRoute from './routes/admin/home.route'
import adminInventoryRoute from './routes/admin/inventory.route'
import adminStaffRoute from './routes/admin/staff.route'
import authRoute from './routes/auth.route'
import healthRoute from './routes/health.route'
import homeRoute from './routes/home.route'
import phoneVerificationRoute from './routes/phone.route'
import adminCourtCostRoute from './routes/admin/court-cost.route'
import adminCourtRoute from './routes/admin/court.route'
import adminBallboyCostRoute from './routes/admin/ballboy-cost.route'
import adminCoachCostRoute from './routes/admin/coach-cost.route'
import bannerRoute from './routes/banner.route'
import adminBannerRoute from './routes/admin/banner.route'
import courtRoute from './routes/court.route'
import adminClassRoute from './routes/admin/class.route'
import classRouter from './routes/class.route'
import adminMembershipRoute from './routes/admin/membership.route'
import classRoute from './routes/class.route'
import membershipRoute from './routes/membership.route'

dayjs.locale('id')
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(duration)
dayjs.extend(isSameOrBefore)
dayjs.tz.setDefault(JAKARTA_TZ)

const app = createApp()

app.use('/storage/*', serveStatic({ root: './src' }))

// ADD NEW ROUTES HERE
const routes = [
  homeRoute,
  healthRoute,
  phoneVerificationRoute,
  authRoute,
  bannerRoute,
  courtRoute,
  classRoute,
  membershipRoute,
]

// ADD NEW ADMIN ROUTES HERE
const adminRoutes = [
  adminHomeRoute,
  adminAuthRoute,
  adminInventoryRoute,
  adminStaffRoute,
  adminCourtRoute,
  adminCourtCostRoute,
  adminBallboyCostRoute,
  adminCoachCostRoute,
  adminBannerRoute,
  adminClassRoute,
  adminMembershipRoute
]

routes.forEach((route) => {
  app.route('/', route)
})

adminRoutes.forEach((route) => {
  app.route('/admin', route)
})

export default app
