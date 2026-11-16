import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Prisma } from '@prisma/client'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { validateHook } from '@/helpers/validate-hook'
import { requireAnyAdminRole } from '@/middlewares/auth'
import { withBranchContext, branchContext } from '@/lib/branch-context'
import { NotFoundException } from '@/exceptions'
import {
  getMembershipTracking,
  getTrackedPackageStatus,
} from '@/services/membership-tracking.service'

// Membership wallets and their usage are shared across playing locations.
function wallet<T>(read: () => Promise<T>) {
  const current = branchContext.getStore()
  return withBranchContext(
    {
      branchId: null,
      isAdmin: true,
      isSuperAdmin: current?.isSuperAdmin ?? false,
      staffId: current?.staffId,
      membershipMode: 'wallet',
    },
    read,
  )
}
const permission = requireAnyAdminRole(['ADMIN', 'ADMIN_VIEWER'])
export const membershipMembersHandler = factory.createHandlers(
  permission,
  zValidator(
    'query',
    z.object({
      q: z.string().trim().max(100).default(''),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      sport: z.enum(['PADEL', 'TENNIS']).optional(),
    }),
    validateHook,
  ),
  async (c) => {
    const { q, page, sport } = c.req.valid('query')
    const data = await wallet(async () => {
      const where: Prisma.MembershipUserWhereInput = {
        invoice: { status: 'PAID' },
        ...(sport ? { membership: { sport } } : {}),
        ...(q
          ? {
              OR: [
                { user: { name: { contains: q, mode: 'insensitive' } } },
                { user: { phone: { contains: q } } },
                { user: { email: { contains: q, mode: 'insensitive' } } },
                { membership: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      }
      const [total, packages] = await Promise.all([
        db.membershipUser.count({ where }),
        db.membershipUser.findMany({
          where,
          skip: (page - 1) * 20,
          take: 20,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            startDate: true,
            endDate: true,
            remainingSessions: true,
            isExpired: true,
            isSuspended: true,
            user: { select: { name: true, phone: true, email: true } },
            membership: {
              select: { name: true, sport: true, type: true, sessions: true },
            },
          },
        }),
      ])
      const now = new Date()
      return {
        total,
        page,
        pageSize: 20,
        packages: packages.map((pack) => ({
          ...pack,
          status: getTrackedPackageStatus(pack, now),
        })),
      }
    })
    return c.json(ok(data))
  },
)

export const membershipMemberTrackingHandler = factory.createHandlers(
  permission,
  zValidator(
    'param',
    z.object({ id: z.string().min(1).max(200) }),
    validateHook,
  ),
  async (c) => {
    const data = await wallet(async () => {
      const pack = await db.membershipUser.findFirst({
        where: { id: c.req.valid('param').id, invoice: { status: 'PAID' } },
        select: {
          id: true,
          userId: true,
          user: { select: { name: true, phone: true, email: true } },
        },
      })
      if (!pack) throw new NotFoundException('Paket member tidak ditemukan.')
      return {
        user: pack.user,
        ...(await getMembershipTracking(pack.userId, pack.id)),
      }
    })
    return c.json(ok(data))
  },
)
