import { createRouter } from '@/lib/create-app'
import {
  createCourtCostHandler,
  updateCourtCostHandler,
} from '@/services/court-cost.service'

const adminCourtCostRoute = createRouter()
  .post('/', ...createCourtCostHandler)
  .put('/:id', ...updateCourtCostHandler)

export default adminCourtCostRoute
