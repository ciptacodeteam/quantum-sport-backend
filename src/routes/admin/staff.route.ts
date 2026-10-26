import { requireAdmin } from '@/middlewares/auth'
import {
  changeStaffPasswordHandler,
  createStaffHandler,
  getAllStaffHandler,
  getStaffCostsHandler,
  getStaffHandler,
  revokeStaffTokenHandler,
  updateStaffHandler,
} from '@/handlers/admin/staff.handler'
import { createRouter } from '@/lib/create-app'

const adminStaffRoute = createRouter()
  .basePath('/staffs')
  .get('/', ...getAllStaffHandler)
  .get('/:id', ...getStaffHandler)
  .get('/:id/costing', ...getStaffCostsHandler)
  .put('/:id', requireAdmin, ...updateStaffHandler)
  .post('/', requireAdmin, ...createStaffHandler)
  .post('/:id/reset-password', requireAdmin, ...changeStaffPasswordHandler)
  .post('/:id/revoke-sessions', requireAdmin, ...revokeStaffTokenHandler)

export default adminStaffRoute
