import { createRouter } from '@/lib/create-app'
import {
  createCourtCostHandler,
  saveRollingCourtScheduleHandler,
  getCourtCostHandler,
  overrideSingleCourtCostHandler,
  updateCourtCostHandler,
} from '@/handlers/admin/court-cost.handler'

const adminCourtCostRoute = createRouter()
  .basePath('/court-costs')
  .get('/', ...getCourtCostHandler)
  .post('/', ...createCourtCostHandler)
  .put('/rolling', ...saveRollingCourtScheduleHandler)
  .put('/:id', ...updateCourtCostHandler)
  .put('/:id/override', ...overrideSingleCourtCostHandler)

export default adminCourtCostRoute
