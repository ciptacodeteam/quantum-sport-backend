import { requireAnyAdminRole } from '@/middlewares/auth'
import {
  adminCourtChangeOptionsHandler,
  adminChangeCourtHandler,
} from '@/handlers/admin/court-change.handler'
import { createRouter } from '@/lib/create-app'
import {
  getAllBookedCourtsHandler,
  getBookedCourtDetailHandler,
  getBookedCourtsSummaryHandler,
  getBookingsByCourtHandler,
  cancelBookingHandler,
  rescheduleCourtBookingHandler,
} from '@/handlers/admin/booked-court.handler'

const adminBookedCourtRoute = createRouter()
  .basePath('/booked-courts')
  .get('/', ...getAllBookedCourtsHandler)
  .get('/summary', ...getBookedCourtsSummaryHandler)
  .get('/:id', ...getBookedCourtDetailHandler)
  .get('/by-court/:id', ...getBookingsByCourtHandler)
  .put('/:id/cancel', requireAnyAdminRole(['ADMIN']), ...cancelBookingHandler)
  .get('/:id/change-court-options', ...adminCourtChangeOptionsHandler)
  .put('/:id/change-court', ...adminChangeCourtHandler)
  .put('/:id/reschedule', ...rescheduleCourtBookingHandler)

export default adminBookedCourtRoute
