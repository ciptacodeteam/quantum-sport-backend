import { listRecurringBookingsHandler, stopRecurringBookingHandler } from '@/handlers/admin/recurring-booking.handler'
import { createRouter } from '@/lib/create-app'
import {
  approveBookingTransactionHandler,
  exportBookingTransactionsToExcelHandler,
  exportBookingsHandler,
  getAllBookingTransactionsHandler,
  getAllBookingScheduleHandler,
  getBookingTransactionDetailHandler,
  rejectBookingTransactionHandler,
  getOngoingBookingScheduleHandler,
} from '@/handlers/admin/booking.handler'
import { cancelBookingHandler } from '@/handlers/admin/booked-court.handler'

const adminBookingRoute = createRouter()
  .basePath('/bookings')
  .get('/', ...getAllBookingTransactionsHandler)
  .get('/schedule', ...getAllBookingScheduleHandler)
  .get('/ongoing-schedule', ...getOngoingBookingScheduleHandler)
  .get('/export', ...exportBookingsHandler)
  .get('/export/excel', ...exportBookingTransactionsToExcelHandler)
  .get('/recurring', ...listRecurringBookingsHandler)
  .put('/recurring/:id/stop', ...stopRecurringBookingHandler)
  .get('/:id', ...getBookingTransactionDetailHandler)
  .put('/:id/approve', ...approveBookingTransactionHandler)
  .put('/:id/cancel', ...cancelBookingHandler)
  .put('/:id/reject', ...rejectBookingTransactionHandler)

export default adminBookingRoute
