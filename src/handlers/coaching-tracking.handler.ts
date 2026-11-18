import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'

export const getMyCoachingTrackingHandler = factory.createHandlers(
  async (c) => {
    const user = c.get('user')
    if (!user?.id) return c.json(err('Unauthorized', 401), 401)
    // Ownership comes exclusively from the customer session. No branch or customer
    // supplied by the browser can select somebody else's wallet or usage.
    const wallets = await db.inHouseWallet.findMany({
      where: { userId: user.id, deletedAt: null, invoice: { status: 'PAID' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        branchId: true,
        packageName: true,
        totalMinutes: true,
        remainingMinutes: true,
        createdAt: true,
        staff: { select: { name: true, coachType: true, isActive: true } },
        invoice: { select: { number: true, status: true } },
        usages: {
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            minutes: true,
            participants: true,
            createdAt: true,
            restoredAt: true,
            bookingCoach: {
              select: {
                status: true,
                slot: { select: { startAt: true, endAt: true } },
                courtSlot: { select: { court: { select: { name: true } } } },
                booking: {
                  select: {
                    status: true,
                    branch: { select: { name: true } },
                    invoice: { select: { number: true } },
                  },
                },
              },
            },
          },
        },
      },
    })
    const branches = wallets.length
      ? await db.branch.findMany({
          where: {
            id: { in: [...new Set(wallets.map((wallet) => wallet.branchId))] },
          },
          select: { id: true, name: true },
        })
      : []
    const names = new Map(branches.map((branch) => [branch.id, branch.name]))
    return c.json(
      ok({
        packages: wallets.map((wallet) => ({
          id: wallet.id,
          name: wallet.packageName,
          coachName: wallet.staff.name,
          coachType: wallet.staff.coachType,
          branchName: names.get(wallet.branchId) ?? 'Cabang tidak tersedia',
          status:
            wallet.remainingMinutes <= 0
              ? 'EXHAUSTED'
              : wallet.staff.isActive
                ? 'ACTIVE'
                : 'SUSPENDED',
          totalHours: wallet.totalMinutes / 60,
          remainingHours: wallet.remainingMinutes / 60,
          usedHours: wallet.usages
            .filter((usage) => !usage.restoredAt)
            .reduce((sum, usage) => sum + usage.minutes / 60, 0),
          createdAt: wallet.createdAt,
          purchaseInvoice: wallet.invoice,
          usage: wallet.usages.map((usage) => ({
            id: usage.id,
            hours: usage.minutes / 60,
            participants: usage.participants,
            createdAt: usage.createdAt,
            restoredAt: usage.restoredAt,
            status: usage.restoredAt
              ? 'RESTORED'
              : usage.bookingCoach.booking.status !== 'CONFIRMED'
                ? usage.bookingCoach.booking.status
                : usage.bookingCoach.status,
            startAt: usage.bookingCoach.slot.startAt,
            endAt: usage.bookingCoach.slot.endAt,
            courtName: usage.bookingCoach.courtSlot?.court?.name ?? null,
            branchName: usage.bookingCoach.booking.branch.name,
            invoiceNumber: usage.bookingCoach.booking.invoice?.number ?? null,
          })),
        })),
      }),
    )
  },
)
