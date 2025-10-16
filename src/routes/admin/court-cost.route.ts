import { createRouter } from '@/lib/create-app'
import {
  createCourtCostHandler,
  overrideSingleCourtCostHandler,
  updateCourtCostHandler,
} from '@/services/court-cost.service'

const adminCourtCostRoute = createRouter()
  .post('/', ...createCourtCostHandler)
  .put('/:id', ...updateCourtCostHandler)
  .put('/override', ...overrideSingleCourtCostHandler)

export default adminCourtCostRoute
