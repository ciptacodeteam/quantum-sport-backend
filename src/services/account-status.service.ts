import { ForbiddenException } from '@/exceptions'
import { db } from '@/lib/prisma'
import dayjs from 'dayjs'

type BanFields = {
  id: string
  banned: boolean
  banReason: string | null
  banExpires: Date | null
}

/**
 * Lift expired temporary bans, then reject if the account is still banned.
 * Returns the (possibly updated) ban fields.
 */
export async function assertUserNotBanned(user: BanFields): Promise<BanFields> {
  let banned = user.banned
  let banReason = user.banReason
  let banExpires = user.banExpires

  if (banExpires && dayjs().isAfter(banExpires)) {
    await db.user.update({
      where: { id: user.id },
      data: {
        banned: false,
        banExpires: null,
        banReason: null,
      },
    })
    banned = false
    banReason = null
    banExpires = null
  }

  if (banned) {
    throw new ForbiddenException(
      banReason
        ? `Your account has been banned. Reason: ${banReason}`
        : 'Your account has been banned',
    )
  }

  return { id: user.id, banned, banReason, banExpires }
}

export async function assertStaffActive(staff: {
  id: string
  isActive: boolean
}) {
  if (!staff.isActive) {
    throw new ForbiddenException('Your staff account is inactive')
  }
}
