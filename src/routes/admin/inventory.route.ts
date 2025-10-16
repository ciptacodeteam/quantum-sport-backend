import {
  createInventoryHandler,
  deleteInventoryHandler,
  getAllInventoryHandler,
  getInventoryHandler,
  updateInventoryHandler,
} from '@/handlers/admin/inventory.handler'
import { validateHook } from '@/helpers/validate-hook'
import { createRouter } from '@/lib/create-app'
import {
  createInventorySchema,
  idSchema,
  searchQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'

const adminInventoryRoute = createRouter()
  .basePath('/inventory')
  .get(
    '/',
    zValidator('query', searchQuerySchema, validateHook),
    getAllInventoryHandler,
  )
  .get('/:id', zValidator('param', idSchema, validateHook), getInventoryHandler)
  .post(
    '/',
    zValidator('json', createInventorySchema, validateHook),
    createInventoryHandler,
  )
  .patch(
    '/:id',
    zValidator('param', idSchema, validateHook),
    zValidator('json', createInventorySchema, validateHook),
    updateInventoryHandler,
  )
  .delete(
    '/:id',
    zValidator('param', idSchema, validateHook),
    deleteInventoryHandler,
  )

export default adminInventoryRoute
