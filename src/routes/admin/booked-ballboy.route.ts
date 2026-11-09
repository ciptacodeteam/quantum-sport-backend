import { requireAnyAdminRole } from '@/middlewares/auth'
import { factory } from '@/lib/create-app'
import {
  cancelBallboyBookingHandler,
  previewBallboyCancellationHandler,
  getAllBookedBallboysHandler,
  getBookedBallboyDetailHandler,
} from '@/handlers/admin/booked-ballboy.handler'

const adminBookedBallboyRoute = factory
  .createApp()
  .basePath('/booked-ballboys')
  .get('/', ...getAllBookedBallboysHandler)
  .get('/:id', ...getBookedBallboyDetailHandler)
  .get(
    '/:id/cancellation',
    requireAnyAdminRole(['SUPER_ADMIN', 'ADMIN', 'CASHIER']),
    ...previewBallboyCancellationHandler,
  )
  .put(
    '/:id/cancel',
    requireAnyAdminRole(['SUPER_ADMIN', 'ADMIN', 'CASHIER']),
    ...cancelBallboyBookingHandler,
  )

export default adminBookedBallboyRoute
