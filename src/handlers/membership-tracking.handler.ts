import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { getTrackedPackageStatus } from '@/services/membership-tracking.service'
import status from 'http-status'

export const getMyMembershipTrackingHandler = factory.createHandlers(
  async (c) => {
    const user = c.get('user')
    if (!user?.id)
      return c.json(
        err('Unauthorized', status.UNAUTHORIZED),
        status.UNAUTHORIZED,
      )
    const packages = await db.membershipUser.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        remainingSessions: true,
        isExpired: true,
        isSuspended: true,
        membership: {
          select: {
            name: true,
            sport: true,
            type: true,
            sessions: true,
            duration: true,
          },
        },
        invoice: { select: { number: true, status: true } },
        usedBookings: {
          where: { membershipSessionsUsed: { gt: 0 } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            membershipSessionsUsed: true,
            createdAt: true,
            cancelledAt: true,
            branch: { select: { id: true, name: true, address: true } },
            invoice: { select: { number: true, status: true } },
            details: {
              select: {
                court: { select: { id: true, name: true } },
                slot: {
                  select: {
                    courtId: true,
                    startAt: true,
                    endAt: true,
                    court: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    })
    const now = new Date()
    return c.json(
      ok({
        packages: packages.map((pack) => ({
          id: pack.id,
          name: pack.membership.name,
          sport: pack.membership.sport,
          type: pack.membership.type,
          status: getTrackedPackageStatus(pack, now),
          totalHours: pack.membership.sessions,
          remainingHours: pack.remainingSessions,
          usedHours: pack.usedBookings
            .filter((booking) => booking.status === 'CONFIRMED')
            .reduce(
              (total, booking) => total + booking.membershipSessionsUsed,
              0,
            ),
          heldHours: pack.usedBookings
            .filter((booking) => booking.status === 'HOLD')
            .reduce(
              (total, booking) => total + booking.membershipSessionsUsed,
              0,
            ),
          startDate: pack.startDate,
          endDate: pack.endDate,
          remainingDays: Math.max(
            0,
            Math.ceil((pack.endDate.getTime() - now.getTime()) / 86400000),
          ),
          purchaseInvoice: pack.invoice,
          usage: pack.usedBookings.map((booking) => ({
            id: booking.id,
            status: booking.status,
            hours: booking.membershipSessionsUsed,
            createdAt: booking.createdAt,
            invoiceNumber: booking.invoice?.number ?? null,
            branch: booking.branch,
            details: booking.details,
          })),
        })),
      }),
      status.OK,
    )
  },
)
