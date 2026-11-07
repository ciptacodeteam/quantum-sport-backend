import { createRouter } from '@/lib/create-app'
import {
  getAvailableBallboyHandler,
  getBallboysHandler,
} from '@/handlers/ballboy.handler'

const ballboyRoute = createRouter()
  .basePath('/ballboys')
  .get('/', ...getBallboysHandler)
  .get('/availability', ...getAvailableBallboyHandler)

export default ballboyRoute
