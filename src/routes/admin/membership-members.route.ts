import { createRouter } from '@/lib/create-app'
import {
  membershipMembersHandler,
  membershipMemberTrackingHandler,
} from '@/handlers/admin/membership-members.handler'

export default createRouter()
  .basePath('/analytics/membership-members')
  .get('/', ...membershipMembersHandler)
  .get('/:id', ...membershipMemberTrackingHandler)
