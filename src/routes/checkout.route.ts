import { checkoutHandler } from '@/handlers/checkout.handler'
import { createRouter } from '@/lib/create-app'

const checkoutRoute = createRouter()
  .basePath('/checkout')
  .post('/', ...checkoutHandler)

export default checkoutRoute
