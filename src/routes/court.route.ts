import { createRouter } from '@/lib/create-app'
import { ok } from '@/lib/response'
import { defaultTariffPeriod } from '@/lib/tariff-period'
import { getTariffPeriods } from '@/services/tariff-policy.service'
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
  .get('/tariff-periods', async (c) =>
    c.json(
      ok({
        rules: await getTariffPeriods(
          undefined,
          c.get('branchId') ?? undefined,
        ),
        defaults: defaultTariffPeriod,
      }),
    ),
  )
  .get('/slots', ...getAvailableCourtSlotsHandler)
  .get('/:id/slots', ...getCourtSlotsHandler)
  .get('/:id', ...getCourtHandler)

export default courtRoute
