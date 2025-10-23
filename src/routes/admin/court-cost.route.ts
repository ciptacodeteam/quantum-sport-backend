import { createRouter } from '@/lib/create-app'
import {
  createCourtCostHandler,
  getCourtCostHandler,
  overrideSingleCourtCostHandler,
  updateCourtCostHandler,
} from '@/handlers/admin/court-cost.handler'

const adminCourtCostRoute = createRouter()
  .basePath('/court-costs')
  .get('/', ...getCourtCostHandler)
  .post('/', ...createCourtCostHandler)
  .put('/:id', ...updateCourtCostHandler)
  .put('/override', ...overrideSingleCourtCostHandler)

export default adminCourtCostRoute
