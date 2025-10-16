import {
  createCourtHandler,
  deleteCourtHandler,
  getAllCourtHandler,
  getCourtHandler,
  updateCourtHandler,
} from '@/handlers/admin/court.service'
import { createRouter } from '@/lib/create-app'

const adminCourtRoute = createRouter()
  .basePath('/courts')
  .get('/', ...getAllCourtHandler)
  .get('/:id', ...getCourtHandler)
  .post('/:id', ...updateCourtHandler)
  .post('/', ...createCourtHandler)
  .delete('/:id', ...deleteCourtHandler)

export default adminCourtRoute
