import dayjs from 'dayjs'
import 'dayjs/locale/id'
import duration from 'dayjs/plugin/duration'

import configureOpenAPI from './lib/configure-openapi'
import createApp from './lib/create-app'

import { healthRoute, homeRoute, phoneRoute } from './routes'

dayjs.extend(duration).locale('id')

const app = createApp()

const routes = [homeRoute, healthRoute, phoneRoute]

configureOpenAPI(app)

routes.forEach((route) => {
  app.route('/', route)
})

export default app
