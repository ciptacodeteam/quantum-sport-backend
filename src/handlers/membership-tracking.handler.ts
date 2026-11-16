import { factory } from '@/lib/create-app'
import { err, ok } from '@/lib/response'
import { getMembershipTracking } from '@/services/membership-tracking.service'
import status from 'http-status'

export const getMyMembershipTrackingHandler = factory.createHandlers(
  async (c) => {
    const user = c.get('user')
    if (!user?.id)
      return c.json(
        err('Unauthorized', status.UNAUTHORIZED),
        status.UNAUTHORIZED,
      )
    return c.json(ok(await getMembershipTracking(user.id)), status.OK)
  },
)
