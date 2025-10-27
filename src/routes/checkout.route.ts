import { checkoutHandler } from '@/handlers/checkout.handler'
import { createRouter } from '@/lib/create-app'
import { requireAuth } from '@/middlewares/auth'

const checkoutRoute = createRouter()
  .basePath('/checkout')
  .use(requireAuth) // Require authentication
  .post('/', ...checkoutHandler)

export default checkoutRoute

