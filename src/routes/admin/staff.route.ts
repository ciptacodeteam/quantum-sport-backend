import {
  changeStaffPasswordHandler,
  createStaffHandler,
  getAllStaffHandler,
  getStaffHandler,
  updateStaffHandler,
} from '@/handlers/admin/staff.handler'
import { createRouter } from '@/lib/create-app'

const adminStaffRoute = createRouter()
  .basePath('/staffs')
  .get('/', ...getAllStaffHandler)
  .get('/:id', ...getStaffHandler)
  .put('/:id', ...updateStaffHandler)
  .post('/', ...createStaffHandler)
  .post('/:id/password', ...changeStaffPasswordHandler)

export default adminStaffRoute
