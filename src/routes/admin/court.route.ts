import {
  createCourtHandler,
  deleteCourtHandler,
  getAllCourtHandler,
  getCourtHandler,
  updateCourtHandler,
} from '@/handlers/admin/court.handler'
import { createRouter } from '@/lib/create-app'

const adminCourtRoute = createRouter()
  .basePath('/courts')
  .get('/', ...getAllCourtHandler)
  .get('/:id', ...getCourtHandler)
  .put('/:id', ...updateCourtHandler)
  .post('/', ...createCourtHandler)
  .delete('/:id', ...deleteCourtHandler)

export default adminCourtRoute
