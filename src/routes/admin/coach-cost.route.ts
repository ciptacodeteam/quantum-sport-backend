import { createRouter } from '@/lib/create-app'
import {
  createCoachCostHandler,
  getCoachCostHandler,
  overrideSingleCoachCostHandler,
  updateCoachCostHandler,
} from '@/handlers/admin/coach-cost.handler'

const adminCoachCostRoute = createRouter()
  .basePath('/coach-costs')
  .get('/', ...getCoachCostHandler)
  .post('/', ...createCoachCostHandler)
  .put('/:id', ...updateCoachCostHandler)
  .put('/override', ...overrideSingleCoachCostHandler)

export default adminCoachCostRoute
