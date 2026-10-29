import { createRouter } from '@/lib/create-app'
import {
  getCourtBookingWindowHandler,
  getAllCourtHandler,
  getAvailableCourtSlotsHandler,
  getCourtHandler,
  getCourtSlotsHandler,
} from '@/handlers/court.handler'

const courtRoute = createRouter()
  .basePath('/courts')
  .get('/', ...getAllCourtHandler)
  .get('/booking-window', ...getCourtBookingWindowHandler)
  .get('/slots', ...getAvailableCourtSlotsHandler)
  .get('/:id/slots', ...getCourtSlotsHandler)
  .get('/:id', ...getCourtHandler)

export default courtRoute
