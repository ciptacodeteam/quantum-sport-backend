import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { factory } from '@/lib/create-app'
import { validateHook } from '@/helpers/validate-hook'
import { ok } from '@/lib/response'
import {
  deleteUnusedCoachingProfile,
  setCoachingProfileActive,
} from '@/services/coaching-profile-lifecycle.service'

const params = z.object({ id: z.string().min(1) })
export const setCoachingProfileActiveHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  zValidator(
    'json',
    z.object({ isActive: z.boolean() }).strict(),
    validateHook,
  ),
  async (c) =>
    c.json(
      ok(
        await setCoachingProfileActive(
          c.req.valid('param').id,
          c.req.valid('json').isActive,
        ),
      ),
    ),
)
export const deleteCoachingProfileHandler = factory.createHandlers(
  zValidator('param', params, validateHook),
  async (c) =>
    c.json(ok(await deleteUnusedCoachingProfile(c.req.valid('param').id))),
)
