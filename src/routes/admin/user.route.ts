import {
  banUserHandler,
  getAllUsersHandler,
  getUserDetailHandler,
  sendResetPasswordLinkHandler,
  unbanUserHandler,
  updateUserHandler,
  searchCustomersHandler,
  getCustomerMembershipDetailsHandler,
  verifyUserPhoneManuallyHandler,
} from '@/handlers/admin/user.handler'
import { createRouter } from '@/lib/create-app'

const adminUserRoute = createRouter()
  .basePath('/customers')
  .get('/', ...getAllUsersHandler)
  .get('/search', ...searchCustomersHandler)
  .get('/:id', ...getUserDetailHandler)
  .get('/:id/membership', ...getCustomerMembershipDetailsHandler)
  .put('/:id', ...updateUserHandler)
  .post('/:id/verify-phone', ...verifyUserPhoneManuallyHandler)
  .post('/:id/send-reset-password', ...sendResetPasswordLinkHandler)
  // .post('/:id/send-change-phone', ...sendChangePhoneLinkHandler) # salah
  .put('/:id/ban', ...banUserHandler)
  .post('/:id/unban', ...unbanUserHandler)

export default adminUserRoute
