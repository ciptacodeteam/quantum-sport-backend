import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { factory } from '@/lib/create-app'
import { validateHook } from '@/helpers/validate-hook'
import { requireAnyAdminRole } from '@/middlewares/auth'
import { ForbiddenException } from '@/exceptions'
import { ok } from '@/lib/response'
import {
  getAdminCourtChangeOptions,
  changeAdminCourt,
} from '@/services/admin-court-change.service'

const access = requireAnyAdminRole(['ADMIN', 'CASHIER'])
const params = z.object({ id: z.string().min(1).max(128) })
const input = z
  .object({
    sourceSlotId: z.string().min(1).max(128),
    newSlotId: z.string().min(1).max(128),
  })
  .strict()
function selectedBranch(branchId: string | null | undefined, role: string) {
  if (!branchId && role !== 'SUPER_ADMIN')
    throw new ForbiddenException('Pilih cabang yang ditugaskan.')
  return branchId ?? null
}
export const adminCourtChangeOptionsHandler = factory.createHandlers(
  access,
  zValidator('param', params, validateHook),
  async (c) => {
    c.header('Cache-Control', 'private, no-store')
    return c.json(
      ok(
        await getAdminCourtChangeOptions(
          c.get('admin')!.id,
          selectedBranch(c.get('branchId'), c.get('admin')!.role),
          c.req.valid('param').id,
        ),
      ),
    )
  },
)
export const adminChangeCourtHandler = factory.createHandlers(
  access,
  zValidator('param', params, validateHook),
  zValidator('json', input, validateHook),
  async (c) =>
    c.json(
      ok(
        await changeAdminCourt(
          c.get('admin')!.id,
          selectedBranch(c.get('branchId'), c.get('admin')!.role),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        'Court berhasil dipindahkan.',
      ),
    ),
)
