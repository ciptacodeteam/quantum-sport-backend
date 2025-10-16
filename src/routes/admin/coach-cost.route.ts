import { createRouter } from '@/lib/create-app'
import {
  createCoachCostHandler,
  getCoachCostHandler,
  overrideSingleCoachCostHandler,
  updateCoachCostHandler,
} from '@/services/coach-cost.service'

const adminCoachCostRoute = createRouter()
  .basePath('/coach-costs')
  .get('/', ...getCoachCostHandler)
  .post('/', ...createCoachCostHandler)
  .put('/:id', ...updateCoachCostHandler)
  .put('/override', ...overrideSingleCoachCostHandler)

export default adminCoachCostRoute
