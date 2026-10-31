import { createRouter } from '@/lib/create-app'
import { zValidator } from '@hono/zod-validator'
import { requireRole, requireAnyAdminRole } from '@/middlewares/auth'
import { validateHook } from '@/helpers/validate-hook'
import { BadRequestException } from '@/exceptions'
import { ok } from '@/lib/response'
import { defaultTariffPeriod, tariffPeriodSchema } from '@/lib/tariff-period'
import { getTariffPeriods } from '@/services/tariff-policy.service'
import { saveTariffPeriod } from '@/services/tariff-settings.service'

const route = createRouter()
  .basePath('/tariff-periods')
  .get(
    '/',
    requireAnyAdminRole(['ADMIN', 'ADMIN_VIEWER', 'CASHIER']),
    async (c) => {
      const branchId = c.get('branchId')
      if (!branchId)
        throw new BadRequestException('Pilih satu cabang terlebih dahulu.')
      return c.json(
        ok({
          rules: await getTariffPeriods(undefined, branchId),
          defaults: defaultTariffPeriod,
        }),
      )
    },
  )
  .put(
    '/',
    requireRole('ADMIN'),
    zValidator('json', tariffPeriodSchema, validateHook),
    async (c) => {
      const branchId = c.get('branchId')
      if (!branchId)
        throw new BadRequestException('Pilih satu cabang terlebih dahulu.')
      return c.json(
        ok(
          await saveTariffPeriod(branchId, c.req.valid('json')),
          'Pengaturan jam tarif berhasil disimpan.',
        ),
      )
    },
  )
export default route
