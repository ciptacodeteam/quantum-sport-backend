import { db } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export function getTariffPeriods(
  client: Pick<Prisma.TransactionClient, 'tariffPeriod'> = db,
  branchId?: string,
) {
  return client.tariffPeriod.findMany({
    where: branchId ? { branchId } : {},
    orderBy: { effectiveFrom: 'asc' },
  })
}
