import { createRouter } from '@/lib/create-app'
import { getAvailableCoachesHandler } from '@/handlers/coach.handler'

const coachRoute = createRouter()
	.basePath('/coaches')
	.get('/availability', ...getAvailableCoachesHandler)

export default coachRoute


