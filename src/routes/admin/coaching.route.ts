import { serviceRescheduleContext } from '@/services/service-reschedule-context.service'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { validateHook } from '@/helpers/validate-hook'
import { ok } from '@/lib/response'
import { cancelCoachBookingHandler } from '@/handlers/admin/booked-coach.handler'
import { createRouter } from '@/lib/create-app'
import { requireAdmin, requireAnyAdminRole } from '@/middlewares/auth'
import {
  previewCoachCancellationHandler,
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
  setCoachClubSettlementHandler,
} from '@/handlers/admin/coaching.handler'

const read = requireAnyAdminRole(['ADMIN', 'CASHIER', 'ADMIN_VIEWER'])
const write = requireAnyAdminRole(['ADMIN', 'CASHIER'])
const cancelService = requireAnyAdminRole(['SUPER_ADMIN', 'CASHIER'])
const replaceCoach = requireAnyAdminRole(['SUPER_ADMIN'])
export default createRouter()
  .basePath('/coaching')
  .get('/', read, ...listCoachingHandler)
  .post('/', requireAdmin, ...createCoachingHandler)
  .get('/bookings', read, ...listCoachingBookingsHandler)
  .get(
    '/bookings/:id/reschedule-court',
    write,
    zValidator(
      'query',
      z.object({ kind: z.enum(['COACH', 'BALLBOY']) }),
      validateHook,
    ),
    async (c) =>
      c.json(
        ok(
          await serviceRescheduleContext(
            c.req.valid('query').kind,
            c.req.param('id'),
          ),
        ),
      ),
  )
  .patch(
    '/bookings/:id/club-settlement',
    requireAdmin,
    ...setCoachClubSettlementHandler,
  )
  .get(
    '/bookings/:id/replacements',
    replaceCoach,
    ...availableCoachReplacementsHandler,
  )
  .post(
    '/bookings/:id/replace-coach',
    replaceCoach,
    ...replaceBookedCoachHandler,
  )
  .get(
    '/bookings/:id/cancellation',
    cancelService,
    ...previewCoachCancellationHandler,
  )
  .post(
    '/bookings/:id/cancel-coach',
    cancelService,
    ...cancelCoachBookingHandler,
  )
  .get('/booking-details/:id/availability', read, ...availableCoachingHandler)
  .post('/booking-details/:id/services', write, ...attachCoachingHandler)
  .patch('/slots/:id', requireAdmin, ...toggleCoachingSlotHandler)
  .get('/:id', read, ...getCoachingHandler)
  .put('/:id', requireAdmin, ...updateCoachingHandler)
  .get('/:id/schedule', read, ...getCoachingScheduleHandler)
  .post('/:id/schedule', requireAdmin, ...saveCoachingScheduleHandler)
