import type { Prisma } from '@prisma/client'
import { BadRequestException, NotFoundException } from '@/exceptions'
import {
  lockCustomerWallet,
  withCustomerWallet,
} from './membership-renewal.service'

export const membershipCancellationInclude = {
  _count: {
    select: {
      usedBookings: true,
      sessionDebits: true,
      recurringBookings: true,
      debtsReceived: true,
      debtsTransferred: true,
    },
  },
} satisfies Prisma.MembershipUserInclude

type CancellationCandidate = {
  remainingSessions: number
  debtSettledSessions: number
  membership: { sessions: number }
  invoice: { status: string } | null
  _count: {
    usedBookings: number
    sessionDebits: number
    recurringBookings: number
    debtsReceived: number
    debtsTransferred: number
  }
}

export function canCancelMembership(pack: CancellationCandidate) {
  return (
    !!pack.invoice &&
    ['PAID', 'PENDING'].includes(pack.invoice.status) &&
    pack.remainingSessions === pack.membership.sessions &&
    pack.debtSettledSessions === 0 &&
    Object.values(pack._count).every((count) => count === 0)
  )
}

export async function cancelUnusedMembership(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const identity = await tx.membershipUser.findUnique({
    where: { id },
    select: { userId: true },
  })
  if (!identity) throw new NotFoundException('Membership transaction not found')
  return withCustomerWallet(async () => {
    await lockCustomerWallet(tx, identity.userId)
    // Block concurrent quota consumption until cancellation is committed.
    await tx.$queryRaw`SELECT id FROM membership_users WHERE id = ${id} FOR UPDATE`
    const pack = await tx.membershipUser.findUnique({
      where: { id },
      include: {
        ...membershipCancellationInclude,
        membership: true,
        invoice: { include: { payment: true } },
      },
    })
    if (!pack) throw new NotFoundException('Membership transaction not found')
    if (!canCancelMembership(pack))
      throw new BadRequestException(
        'Hanya membership yang belum dipakai dan belum dibatalkan yang dapat dibatalkan.',
      )
    const cancelledAt = new Date()
    await tx.invoice.update({
      where: { id: pack.invoice!.id },
      data: { status: 'CANCELLED', cancelledAt },
    })
    if (pack.invoice?.payment)
      await tx.payment.update({
        where: { id: pack.invoice.payment.id },
        data: { status: 'CANCELLED', cancelledAt },
      })
    return tx.membershipUser.update({
      where: { id },
      data: {
        isExpired: true,
        isSuspended: true,
        suspensionReason: 'Dibatalkan oleh admin',
        suspensionEndDate: null,
      },
      include: { membership: true, invoice: true },
    })
  })
}
