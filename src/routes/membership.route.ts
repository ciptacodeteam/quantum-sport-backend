import { getMyMembershipTrackingHandler } from '@/handlers/membership-tracking.handler'
import { createRouter } from '@/lib/create-app'
import {
  getAllMembershipHandler,
  getMembershipHandler,
  getUserMembershipsHandler,
  getMyActiveMembershipHandler,
} from '@/handlers/membership.handler'
import { membershipCheckoutHandler } from '@/handlers/membership-checkout.handler'
import { requireAuth } from '@/middlewares/auth'

const membershipRoute = createRouter()
  .basePath('/memberships')
  .get('/', ...getAllMembershipHandler)
  .get('/my', requireAuth, ...getUserMembershipsHandler)
  .get('/my/tracking', requireAuth, ...getMyMembershipTrackingHandler)
  .get('/my/active', requireAuth, ...getMyActiveMembershipHandler)
  .get('/:id', ...getMembershipHandler)
  .post('/checkout', ...membershipCheckoutHandler)

export default membershipRoute
