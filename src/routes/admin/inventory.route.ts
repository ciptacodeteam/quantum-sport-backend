import {
  createInventoryHandler,
  deleteInventoryHandler,
  getAllInventoryHandler,
  getInventoryHandler,
  updateInventoryHandler,
} from '@/handlers/admin/inventory.handler'
import { createRouter } from '@/lib/create-app'

const adminInventoryRoute = createRouter()
  .basePath('/inventory')
  .get('/', ...getAllInventoryHandler)
  .get('/:id', ...getInventoryHandler)
  .post('/', ...createInventoryHandler)
  .patch('/:id', ...updateInventoryHandler)
  .delete('/:id', ...deleteInventoryHandler)

export default adminInventoryRoute
