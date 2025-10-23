import { createRouter } from '@/lib/create-app'
import {
  createBallboyCostHandler,
  getBallboyCostHandler,
  overrideSingleBallboyCostHandler,
  updateBallboyCostHandler,
} from '@/handlers/admin/ballboy-cost.handler'

const adminBallboyCostRoute = createRouter()
  .basePath('/ballboy-costs')
  .get('/', ...getBallboyCostHandler)
  .post('/', ...createBallboyCostHandler)
  .put('/:id', ...updateBallboyCostHandler)
  .post('/override', ...overrideSingleBallboyCostHandler)

export default adminBallboyCostRoute
