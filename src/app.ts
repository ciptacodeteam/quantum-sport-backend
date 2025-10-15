import dayjs from 'dayjs'
import 'dayjs/locale/id'
import duration from 'dayjs/plugin/duration'

import configureOpenAPI from './lib/configure-openapi'
import createApp from './lib/create-app'
import authRoute from './routes/auth.route'
import healthRoute from './routes/health.route'
import homeRoute from './routes/home.route'
import phoneVerificationRoute from './routes/phone.route'

dayjs.extend(duration).locale('id')

const app = createApp()

// ADD NEW ROUTES HERE
const routes = [homeRoute, healthRoute, phoneVerificationRoute, authRoute]

configureOpenAPI(app)

routes.forEach((route) => {
  app.route('/', route)
})

export default app
