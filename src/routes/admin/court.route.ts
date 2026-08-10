import {
  bulkUpdateCourtSlotPricingHandler,
  createCourtHandler,
  deleteCourtHandler,
  getAvailableCourtSlotsHandler,
  getAllCourtHandler,
  getCostHandler,
  getCourtHandler,
  updateCourtHandler,
  updateCourtSlotAvailabilityHandler,
  updateSlotPricingHandler,
} from '@/handlers/admin/court.handler'
import { createRouter } from '@/lib/create-app'

const adminCourtRoute = createRouter()
  .basePath('/courts')
  .get('/', ...getAllCourtHandler)
  .get('/slots', ...getAvailableCourtSlotsHandler)
  .get('/:id', ...getCourtHandler)
  .get('/:id/costing', ...getCostHandler)
  .put('/:id/slots/bulk-pricing', ...bulkUpdateCourtSlotPricingHandler)
  .put('/:id', ...updateCourtHandler)
  .put('/slots/:id/pricing', ...updateSlotPricingHandler)
  .post('/', ...createCourtHandler)
  .delete('/:id', ...deleteCourtHandler)
  .put('/slots/:id/availability', ...updateCourtSlotAvailabilityHandler)

export default adminCourtRoute
