import { createRouter } from '@/lib/create-app'
import {
  createCoachCostHandler,
  overrideSingleCoachCostHandler,
  updateCoachCostHandler,
} from '@/services/coach-cost.service'

const adminCoachCostRoute = createRouter()
  .basePath('/coach-costs')
  .post('/', ...createCoachCostHandler)
  .put('/:id', ...updateCoachCostHandler)
  .put('/override', ...overrideSingleCoachCostHandler)

export default adminCoachCostRoute
