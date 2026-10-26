import { BadRequestException } from '@/exceptions'
import type { Prisma } from '@prisma/client'

export async function consumeMembershipHours(
  tx: Prisma.TransactionClient,
  id: string,
  hours: number,
) {
  const result = await tx.membershipUser.updateMany({
    where: {
      id,
      remainingSessions: { gte: hours },
      isExpired: false,
      isSuspended: false,
      endDate: { gt: new Date() },
    },
    data: { remainingSessions: { decrement: hours } },
  })
  if (result.count !== 1)
    throw new BadRequestException(
      'Value Pack sudah tidak tersedia atau sisa jam tidak mencukupi. Silakan periksa kembali pesanan Anda.',
    )
  await tx.membershipUser.updateMany({
    where: { id, remainingSessions: 0 },
    data: { isExpired: true },
  })
}
