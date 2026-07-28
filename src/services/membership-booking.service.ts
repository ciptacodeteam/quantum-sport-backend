type MembershipBookingUsage = {
  membershipUserId?: string | null
  membershipSessionsUsed?: number | null
}

type MembershipCourtSlot = {
  startAt: Date
  endAt: Date
}

type MembershipBookingTransaction = {
  membershipUser: {
    findUnique: (args: {
      where: { id: string }
      include: {
        membership: {
          select: {
            sessions: true
          }
        }
      }
    }) => Promise<{
      id: string
      remainingSessions: number
      endDate: Date
      membership: {
        sessions: number
      }
    } | null>
    update: (args: {
      where: { id: string }
      data: {
        remainingSessions: number
        isExpired: boolean
      }
    }) => Promise<unknown>
  }
}

export function calculateMembershipSessionsForCourtSlots(
  courtSlots: MembershipCourtSlot[],
) {
  const totalMinutes = courtSlots.reduce((total, slot) => {
    const durationMs = slot.endAt.getTime() - slot.startAt.getTime()

    return total + Math.max(0, durationMs / 60_000)
  }, 0)

  if (totalMinutes === 0) {
    return 0
  }

  return Math.ceil(totalMinutes / 60)
}

export async function restoreMembershipSessionsForCancelledBooking(
  tx: MembershipBookingTransaction,
  booking: MembershipBookingUsage,
) {
  if (!booking.membershipUserId || !booking.membershipSessionsUsed) {
    return 0
  }

  const sessionsToRestore = Math.max(
    0,
    Math.trunc(booking.membershipSessionsUsed),
  )
  if (sessionsToRestore === 0) {
    return 0
  }

  const membershipUser = await tx.membershipUser.findUnique({
    where: { id: booking.membershipUserId },
    include: {
      membership: {
        select: {
          sessions: true,
        },
      },
    },
  })

  if (!membershipUser) {
    return 0
  }

  const restoredSessions = Math.min(
    sessionsToRestore,
    Math.max(
      0,
      membershipUser.membership.sessions - membershipUser.remainingSessions,
    ),
  )

  if (restoredSessions === 0) {
    return 0
  }

  await tx.membershipUser.update({
    where: { id: membershipUser.id },
    data: {
      remainingSessions: membershipUser.remainingSessions + restoredSessions,
      isExpired: membershipUser.endDate <= new Date(),
    },
  })

  return restoredSessions
}
