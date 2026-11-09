import { createRouter } from '@/lib/create-app'
import {
  approveMembershipTransactionHandler,
  exportMembershipTransactionsToExcelHandler,
  getAllMembershipTransactionsHandler,
  getMembershipTransactionDetailHandler,
  rejectMembershipTransactionHandler,
  suspendMembershipTransactionHandler,
  unsuspendMembershipTransactionHandler,
} from '@/handlers/admin/membership-transaction.handler'

const adminMembershipTransactionRoute = createRouter()
  .basePath('/membership-transactions')
  .get('/', ...getAllMembershipTransactionsHandler)
  .get('/export/excel', ...exportMembershipTransactionsToExcelHandler)
  .get('/:id', ...getMembershipTransactionDetailHandler)
  .put('/:id/approve', ...approveMembershipTransactionHandler)
  .put('/:id/cancel', ...rejectMembershipTransactionHandler)
  .put('/:id/reject', ...rejectMembershipTransactionHandler)
  .put('/:id/suspend', ...suspendMembershipTransactionHandler)
  .put('/:id/unsuspend', ...unsuspendMembershipTransactionHandler)

export default adminMembershipTransactionRoute
