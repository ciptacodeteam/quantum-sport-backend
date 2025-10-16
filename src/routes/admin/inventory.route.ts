import {
  createInventoryHandler,
  getInventoryItemsHandler,
} from '@/handlers/admin/inventory.handler'
import { validateHook } from '@/helpers/validate-hook'
import { createRouter } from '@/lib/create-app'
import { createInventorySchema, searchQuerySchema } from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'

const adminInventoryRoute = createRouter()
  .basePath('/inventory')
  .get(
    '/',
    zValidator('query', searchQuerySchema, validateHook),
    getInventoryItemsHandler,
  )
  .post(
    '/',
    zValidator('json', createInventorySchema, validateHook),
    createInventoryHandler,
  )

export default adminInventoryRoute
