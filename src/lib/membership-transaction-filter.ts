import type { Prisma } from '@prisma/client'

export const membershipTransactionStatuses = [
  'Aktif',
  'Menunggu pembayaran',
  'Ditangguhkan',
  'Kedaluwarsa',
  'Sesi habis',
  'Dibatalkan',
] as const

export function membershipTransactionStatusWhere(
  status?: string,
): Prisma.MembershipUserWhereInput {
  switch (status) {
    case 'Aktif':
      return {
        invoice: { status: 'PAID' },
        isExpired: false,
        isSuspended: false,
        remainingSessions: { gt: 0 },
      }
    case 'Menunggu pembayaran':
      return {
        invoice: { status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] } },
      }
    case 'Ditangguhkan':
      return {
        invoice: { status: 'PAID' },
        isExpired: false,
        isSuspended: true,
      }
    case 'Kedaluwarsa':
      return {
        OR: [
          { invoice: { status: 'EXPIRED' } },
          { invoice: { status: 'PAID' }, isExpired: true },
        ],
      }
    case 'Sesi habis':
      return {
        invoice: { status: 'PAID' },
        isExpired: false,
        isSuspended: false,
        remainingSessions: { lte: 0 },
      }
    case 'Dibatalkan':
      return { invoice: { status: { in: ['CANCELLED', 'REFUNDED'] } } }
    default:
      return {}
  }
}
