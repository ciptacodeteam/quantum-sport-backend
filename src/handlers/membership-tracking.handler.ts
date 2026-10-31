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
        debtSettledSessions: true,
        debtsTransferred: {
          select: { sessions: true, restoredSessions: true },
        },
        sessionDebits: {
          where: { reversedAt: null },
          select: {
            sessions: true,
            detail: {
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
                booking: {
                  select: {
                    id: true,
                    status: true,
                    createdAt: true,
                    branch: { select: { id: true, name: true, address: true } },
                    invoice: { select: { number: true } },
                  },
                },
              },
            },
          },
        },
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
          where: {
            membershipSessionsUsed: { gt: 0 },
            recurringOccurrences: { none: {} },
          },
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
        packages: packages.map((pack) => {
          const normalUsage = pack.usedBookings.map((booking) => ({
            id: booking.id,
            status: booking.status,
            hours: booking.membershipSessionsUsed,
            createdAt: booking.createdAt,
            invoiceNumber: booking.invoice?.number ?? null,
            branch: booking.branch,
            details: booking.details,
          }))
          const recurringUsage = new Map<string, (typeof normalUsage)[number]>()
          for (const debit of pack.sessionDebits ?? []) {
            const booking = debit.detail.booking
            const entry = recurringUsage.get(booking.id) ?? {
              id: booking.id,
              status: booking.status,
              hours: 0,
              createdAt: booking.createdAt,
              invoiceNumber: booking.invoice?.number ?? null,
              branch: booking.branch,
              details: [],
            }
            entry.hours += debit.sessions
            entry.details.push({
              court: debit.detail.court,
              slot: debit.detail.slot,
            })
            recurringUsage.set(booking.id, entry)
          }
          const usage = [...normalUsage, ...recurringUsage.values()]
          return {
            id: pack.id,
            name: pack.membership.name,
            sport: pack.membership.sport,
            type: pack.membership.type,
            status: getTrackedPackageStatus(pack, now),
            totalHours: pack.membership.sessions,
            remainingHours: pack.remainingSessions,
            debtSettledHours: pack.debtSettledSessions ?? 0,
            debtTransferredHours: (pack.debtsTransferred ?? []).reduce(
              (sum, debt) => sum + debt.sessions - debt.restoredSessions,
              0,
            ),
            usedHours: usage
              .filter((booking) => booking.status === 'CONFIRMED')
              .reduce((sum, booking) => sum + booking.hours, 0),
            heldHours: usage
              .filter((booking) => booking.status === 'HOLD')
              .reduce((sum, booking) => sum + booking.hours, 0),
            startDate: pack.startDate,
            endDate: pack.endDate,
            remainingDays: Math.max(
              0,
              Math.ceil((pack.endDate.getTime() - now.getTime()) / 86400000),
            ),
            purchaseInvoice: pack.invoice,
            usage,
          }
        }),
      }),
      status.OK,
    )
  },
)
