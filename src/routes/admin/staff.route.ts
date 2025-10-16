import {
  changeStaffPasswordHandler,
  createBallboyScheduleHandler,
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
  .post('/:id/password', ...changeStaffPasswordHandler)
  .post('/:id/revoke', ...revokeStaffTokenHandler)
  .post('/:id/ballboy-schedule', ...createBallboyScheduleHandler)

export default adminStaffRoute
