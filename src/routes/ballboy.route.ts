import { createRouter } from '@/lib/create-app'
import { getAvailableBallboyHandler } from '@/handlers/ballboy.handler'

const ballboyRoute = createRouter()
	.basePath('/ballboys')
	.get('/availability', ...getAvailableBallboyHandler)

export default ballboyRoute


