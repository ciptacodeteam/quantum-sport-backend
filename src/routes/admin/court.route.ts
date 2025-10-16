import {
  createCourtHandler,
  deleteCourtHandler,
  getAllCourtHandler,
  getCourtHandler,
  updateCourtHandler,
} from '@/handlers/admin/court.service'
import { createRouter } from '@/lib/create-app'

const adminCourtRoute = createRouter()
  .get('/', ...getAllCourtHandler)
  .get('/:id', ...getCourtHandler)
  .post('/', ...createCourtHandler)
  .put('/:id', ...updateCourtHandler)
  .delete('/:id', ...deleteCourtHandler)

export default adminCourtRoute
