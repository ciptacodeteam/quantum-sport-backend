import {
  changeStaffPasswordHandler,
  createStaffHandler,
  getAllStaffHandler,
  getStaffHandler,
  revokeStaffTokenHandler,
  updateStaffHandler,
} from '@/handlers/admin/staff.handler'
import { createRouter } from '@/lib/create-app'

const adminStaffRoute = createRouter()
  .basePath('/staffs')
  .get('/', ...getAllStaffHandler)
  .get('/:id', ...getStaffHandler)
  .put('/:id', ...updateStaffHandler)
  .post('/', ...createStaffHandler)
  .post('/:id/reset-password', ...changeStaffPasswordHandler)
  .post('/:id/revoke-sessions', ...revokeStaffTokenHandler)

export default adminStaffRoute
