import { createRouter } from '@/lib/create-app'
import {
  createBallboyCostHandler,
  overrideSingleBallboyCostHandler,
  updateBallboyCostHandler,
} from '@/services/ballboy-cost.service'

const adminBallboyCostRoute = createRouter()
  .basePath('/ballboy-costs')
  .post('/', ...createBallboyCostHandler)
  .put('/:id', ...updateBallboyCostHandler)
  .put('/override', ...overrideSingleBallboyCostHandler)

export default adminBallboyCostRoute
