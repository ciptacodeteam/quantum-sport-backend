import { createRouter } from '@/lib/create-app'
import { requireAdmin, requireAnyAdminRole } from '@/middlewares/auth'
import {
  availableCoachReplacementsHandler,
  replaceBookedCoachHandler,
  listCoachingHandler,
  getCoachingHandler,
  createCoachingHandler,
  updateCoachingHandler,
  getCoachingScheduleHandler,
  saveCoachingScheduleHandler,
  toggleCoachingSlotHandler,
  availableCoachingHandler,
  attachCoachingHandler,
  listCoachingBookingsHandler,
} from '@/handlers/admin/coaching.handler'

const read = requireAnyAdminRole(['ADMIN', 'CASHIER', 'ADMIN_VIEWER'])
const write = requireAnyAdminRole(['ADMIN', 'CASHIER'])
export default createRouter()
  .basePath('/coaching')
  .get('/', read, ...listCoachingHandler)
  .post('/', requireAdmin, ...createCoachingHandler)
  .get('/bookings', read, ...listCoachingBookingsHandler)
  .get(
    '/bookings/:id/replacements',
    write,
    ...availableCoachReplacementsHandler,
  )
  .post('/bookings/:id/replace-coach', write, ...replaceBookedCoachHandler)
  .get('/booking-details/:id/availability', read, ...availableCoachingHandler)
  .post('/booking-details/:id/services', write, ...attachCoachingHandler)
  .patch('/slots/:id', requireAdmin, ...toggleCoachingSlotHandler)
  .get('/:id', read, ...getCoachingHandler)
  .put('/:id', requireAdmin, ...updateCoachingHandler)
  .get('/:id/schedule', read, ...getCoachingScheduleHandler)
  .post('/:id/schedule', requireAdmin, ...saveCoachingScheduleHandler)
