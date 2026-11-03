import { requireAnyAdminRole } from '@/middlewares/auth'
import { factory } from '@/lib/create-app'
import {
  cancelCoachBookingHandler,
  getAllBookedCoachesHandler,
  getBookedCoachDetailHandler,
} from '@/handlers/admin/booked-coach.handler'

const adminBookedCoachRoute = factory
  .createApp()
  .basePath('/booked-coaches')
  .get('/', ...getAllBookedCoachesHandler)
  .get('/:id', ...getBookedCoachDetailHandler)
  .put(
    '/:id/cancel',
    requireAnyAdminRole(['SUPER_ADMIN']),
    ...cancelCoachBookingHandler,
  )

export default adminBookedCoachRoute
