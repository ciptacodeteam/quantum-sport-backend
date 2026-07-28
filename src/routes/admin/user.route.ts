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
import { requireAdmin, requireAnyAdminRole } from '@/middlewares/auth'

const requireCustomerReadAccess = requireAnyAdminRole([
  'ADMIN',
  'ADMIN_VIEWER',
  'CASHIER',
])
const requireCustomerSupportAccess = requireAnyAdminRole(['ADMIN', 'CASHIER'])

const adminUserRoute = createRouter()
  .basePath('/customers')
  .get('/', requireCustomerReadAccess, ...getAllUsersHandler)
  .get('/search', requireCustomerReadAccess, ...searchCustomersHandler)
  .get('/:id', requireCustomerReadAccess, ...getUserDetailHandler)
  .get(
    '/:id/membership',
    requireCustomerReadAccess,
    ...getCustomerMembershipDetailsHandler,
  )
  .put('/:id', requireCustomerSupportAccess, ...updateUserHandler)
  .post(
    '/:id/verify-phone',
    requireCustomerSupportAccess,
    ...verifyUserPhoneManuallyHandler,
  )
  .post(
    '/:id/send-reset-password',
    requireCustomerSupportAccess,
    ...sendResetPasswordLinkHandler,
  )
  // .post('/:id/send-change-phone', ...sendChangePhoneLinkHandler) # salah
  .put('/:id/ban', requireAdmin, ...banUserHandler)
  .post('/:id/unban', requireAdmin, ...unbanUserHandler)

export default adminUserRoute
