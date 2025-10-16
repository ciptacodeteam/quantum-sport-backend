import { createRouter } from '@/lib/create-app'
import {
  createCourtCostHandler,
  getCourtCostHandler,
  overrideSingleCourtCostHandler,
  updateCourtCostHandler,
} from '@/services/court-cost.service'

const adminCourtCostRoute = createRouter()
  .basePath('/court-costs')
  .get('/', ...getCourtCostHandler)
  .post('/', ...createCourtCostHandler)
  .put('/:id', ...updateCourtCostHandler)
  .put('/override', ...overrideSingleCourtCostHandler)

export default adminCourtCostRoute
