import type { Prisma } from '@prisma/client'
import { BadRequestException } from '@/exceptions'

export const supportedCourtWhere: Prisma.CourtWhereInput = {
  NOT: { sport: 'TENNIS', branchId: { not: 'cemara' } },
}
export const bookableCourtWhere: Prisma.CourtWhereInput = {
  isActive: true,
  ...supportedCourtWhere,
}
export function assertCourtSportAtBranch(
  sport?: string,
  branchId?: string | null,
) {
  if (sport === 'TENNIS' && branchId !== 'cemara')
    throw new BadRequestException('Tennis hanya tersedia di cabang Cemara.')
}
