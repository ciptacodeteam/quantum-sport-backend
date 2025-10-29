import { createRouter } from '@/lib/create-app'
import { getUserInvoicesHandler } from '@/handlers/invoice.handler'
import { requireAuth } from '@/middlewares/auth'

const invoiceRoute = createRouter()
	.basePath('/invoices')
	.use(requireAuth)
	.get('/', ...getUserInvoicesHandler)

export default invoiceRoute


