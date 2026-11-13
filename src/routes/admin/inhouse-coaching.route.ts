import { createRouter, factory } from '@/lib/create-app'
import { requireAdmin, requireAnyAdminRole } from '@/middlewares/auth'
import { zValidator } from '@hono/zod-validator'
import { validateHook } from '@/helpers/validate-hook'
import { z } from 'zod'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { inHousePlanSchema } from '@/lib/inhouse-coaching'
import {
  saveInHousePlan,
  cancelUnusedInHouseWallet,
  sellInHousePlan,
  listInHouseUsage,
} from '@/services/inhouse-coaching.service'
const read = requireAnyAdminRole(['ADMIN', 'CASHIER', 'ADMIN_VIEWER'])
const sell = requireAnyAdminRole(['ADMIN', 'CASHIER'])
const query = z.object({
  userId: z.string().min(1).optional(),
  availableOnly: z.literal('true').optional(),
})
export default createRouter()
  .basePath('/inhouse-coaching')
  .get(
    '/plans',
    read,
    ...factory.createHandlers(async (c) =>
      c.json(
        ok(
          await db.inHousePlan.findMany({
            include: {
              staff: {
                select: {
                  id: true,
                  name: true,
                  isActive: true,
                  coachType: true,
                },
              },
            },
            orderBy: [{ staffId: 'asc' }, { hours: 'asc' }],
          }),
        ),
      ),
    ),
  )
  .post(
    '/plans',
    requireAdmin,
    zValidator('json', inHousePlanSchema, validateHook),
    async (c) =>
      c.json(ok(await saveInHousePlan(undefined, c.req.valid('json'))), 201),
  )
  .put(
    '/plans/:id',
    requireAdmin,
    zValidator('json', inHousePlanSchema, validateHook),
    async (c) =>
      c.json(ok(await saveInHousePlan(c.req.param('id'), c.req.valid('json')))),
  )
  .get('/wallets', read, zValidator('query', query, validateHook), async (c) =>
    c.json(
      ok(
        await db.inHouseWallet.findMany({
          where: {
            ...(c.req.valid('query').userId
              ? { userId: c.req.valid('query').userId }
              : {}),
            ...(c.req.valid('query').availableOnly
              ? {
                  deletedAt: null,
                  remainingMinutes: { gte: 60 },
                  invoice: { status: 'PAID' as const },
                  staff: { isActive: true, role: 'COACH' as const },
                }
              : {}),
          },
          include: {
            _count: { select: { usages: true } },
            user: { select: { id: true, name: true, phone: true } },
            staff: {
              select: { id: true, name: true, coachType: true, isActive: true },
            },
            invoice: {
              select: { id: true, number: true, status: true, total: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        }),
      ),
    ),
  )
  .post('/wallets/:id/cancel', sell, async (c) =>
    c.json(
      ok(
        await cancelUnusedInHouseWallet(c.req.param('id'), c.get('admin')!.id),
      ),
    ),
  )
  // Compatibility for older clients; this also cancels and never removes history.
  .delete('/wallets/:id', sell, async (c) =>
    c.json(
      ok(
        await cancelUnusedInHouseWallet(c.req.param('id'), c.get('admin')!.id),
      ),
    ),
  )
  .post(
    '/sales',
    sell,
    zValidator(
      'json',
      z
        .object({
          packageId: z.string().min(1),
          userId: z.string().min(1),
          paymentMethodId: z.string().min(1),
          requestId: z.string().uuid(),
        })
        .strict(),
      validateHook,
    ),
    async (c) =>
      c.json(
        ok(await sellInHousePlan(c.req.valid('json'), c.get('admin')!.id)),
        201,
      ),
  )
  .get('/usage', read, zValidator('query', query, validateHook), async (c) =>
    c.json(ok(await listInHouseUsage(c.req.valid('query').userId))),
  )
