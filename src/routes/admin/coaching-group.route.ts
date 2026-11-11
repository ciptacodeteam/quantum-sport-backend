import { z } from 'zod'
import type { Context } from 'hono'
import type { AppEnv } from '@/types'
import { BadRequestException } from '@/exceptions'
import { zValidator } from '@hono/zod-validator'
import { validateHook } from '@/helpers/validate-hook'
import { createRouter } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { requireAnyAdminRole } from '@/middlewares/auth'
import {
  deleteCoachingGroup,
  coachingGroupSchema,
  coachingGroupUploadSchema,
  saveCoachingGroupUpload,
  saveCoachingGroup,
} from '@/services/coaching-group.service'
async function saveGroupRequest(c: Context<AppEnv>, id?: string) {
  const status = id ? 200 : 201
  if (c.req.header('Content-Type')?.includes('multipart/form-data')) {
    const parsed = coachingGroupUploadSchema.safeParse(await c.req.parseBody())
    if (!parsed.success)
      return validateHook({ ...parsed, data: undefined, target: 'form' }, c)!
    return c.json(ok(await saveCoachingGroupUpload(id, parsed.data)), status)
  }
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new BadRequestException('Data grup tidak valid.')
  }
  const parsed = coachingGroupSchema.safeParse(body)
  if (!parsed.success)
    return validateHook({ ...parsed, data: undefined, target: 'json' }, c)!
  return c.json(ok(await saveCoachingGroup(id, parsed.data)), status)
}
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
  .post('/', write, (c) => saveGroupRequest(c))
  .put('/:id', write, (c) => saveGroupRequest(c, c.req.param('id')))
  .delete('/:id', write, async (c) =>
    c.json(ok(await deleteCoachingGroup(c.req.param('id')))),
  )
