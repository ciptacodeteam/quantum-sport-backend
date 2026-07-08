import { createRouter } from '@/lib/create-app'
import { getAvailableBallboyHandler } from '@/handlers/ballboy.handler'

const adminBallboyRoute = createRouter()
  .basePath('/ballboy')
  .get('/availability', ...getAvailableBallboyHandler)

export default adminBallboyRoute
