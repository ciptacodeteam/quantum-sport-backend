import { createRouter } from '@/lib/create-app'
import { getAvailableInventoryHandler } from '@/handlers/inventory.handler'

const inventoryRoute = createRouter()
	.basePath('/inventories')
	.get('/availability', ...getAvailableInventoryHandler)

export default inventoryRoute

