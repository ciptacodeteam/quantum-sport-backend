import { getUserInvoicesHandler } from '@/handlers/invoice.handler'
import { createRouter } from '@/lib/create-app'

const invoiceRoute = createRouter()
  .basePath('/invoices')
  .get('/', ...getUserInvoicesHandler)

export default invoiceRoute
