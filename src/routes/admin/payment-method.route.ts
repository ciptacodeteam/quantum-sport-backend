import {
  createPaymentMethodHandler,
  deletePaymentMethodHandler,
  getAllPaymentMethodsHandler,
  getPaymentMethodHandler,
  updatePaymentMethodHandler,
} from '@/handlers/admin/payment-method.handler'
import { createRouter } from '@/lib/create-app'
import { requireAdminAuth } from '@/middlewares/auth'

const paymentMethodRoute = createRouter()
  .basePath('/payment-methods')
  .use(requireAdminAuth)
  .get('/', ...getAllPaymentMethodsHandler)
  .get('/:id', ...getPaymentMethodHandler)
  .post('/', ...createPaymentMethodHandler)
  .put('/:id', ...updatePaymentMethodHandler)
  .delete('/:id', ...deletePaymentMethodHandler)

export default paymentMethodRoute
