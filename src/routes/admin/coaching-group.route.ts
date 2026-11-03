import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { validateHook } from '@/helpers/validate-hook'
import { createRouter } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { requireAnyAdminRole } from '@/middlewares/auth'
import {
  coachingGroupSchema,
  saveCoachingGroup,
} from '@/services/coaching-group.service'
const read = requireAnyAdminRole(['ADMIN', 'CASHIER', 'ADMIN_VIEWER'])
const write = requireAnyAdminRole(['SUPER_ADMIN'])
export default createRouter()
  .basePath('/coaching-groups')
  .get(
    '/',
    read,
    zValidator(
      'query',
      z.object({ branchId: z.string().optional() }),
      validateHook,
    ),
    async (c) => {
      const { branchId } = c.req.valid('query')
      const items = await db.coachingGroup.findMany({
        where:
          branchId && branchId !== 'all'
            ? { branches: { some: { branchId } } }
            : {},
        include: {
          branches: {
            include: { branch: { select: { id: true, name: true } } },
          },
          coaches: { select: { staffId: true } },
        },
        orderBy: { name: 'asc' },
      })
      return c.json(ok(items))
    },
  )
  .post(
    '/',
    write,
    zValidator('json', coachingGroupSchema, validateHook),
    async (c) =>
      c.json(ok(await saveCoachingGroup(undefined, c.req.valid('json'))), 201),
  )
  .put(
    '/:id',
    write,
    zValidator('json', coachingGroupSchema, validateHook),
    async (c) =>
      c.json(
        ok(await saveCoachingGroup(c.req.param('id'), c.req.valid('json'))),
      ),
  )
