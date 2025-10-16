import { createRouter } from '@/lib/create-app'
import {
  createBallboyCostHandler,
  getBallboyCostHandler,
  overrideSingleBallboyCostHandler,
  updateBallboyCostHandler,
} from '@/services/ballboy-cost.service'

const adminBallboyCostRoute = createRouter()
  .basePath('/ballboy-costs')
  .get('/', ...getBallboyCostHandler)
  .post('/', ...createBallboyCostHandler)
  .put('/:id', ...updateBallboyCostHandler)
  .post('/override', ...overrideSingleBallboyCostHandler)

export default adminBallboyCostRoute
