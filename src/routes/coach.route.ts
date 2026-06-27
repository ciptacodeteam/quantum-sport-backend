import { createRouter } from '@/lib/create-app'
import {
  getAvailableCoachesHandler,
  getCoachesHandler,
} from '@/handlers/coach.handler'

const coachRoute = createRouter()
  .basePath('/coaches')
  .get('/', ...getCoachesHandler)
  .get('/availability', ...getAvailableCoachesHandler)

export default coachRoute
