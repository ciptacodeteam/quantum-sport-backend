import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok, err } from '@/lib/response'
import {
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { CourtSport } from '@prisma/client'
import status from 'http-status'
import { InvoiceStatus } from 'xendit-node/invoice/models'
import { z } from 'zod'

const membershipQuerySchema = searchQuerySchema.extend({
  sport: z.nativeEnum(CourtSport).optional(),
})

export const getAllMembershipHandler = factory.createHandlers(
  zValidator('query', membershipQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema & {
        sport?: CourtSport
      }
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { sequence: 'asc' },
        searchableFields: ['name', 'description'],
      })

      const items = await db.membership.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          isActive: true,
          ...(query.sport ? { sport: query.sport } : {}),
        },
        include: {
          benefits: true,
        },
      })

      return c.json(ok(items), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getMembershipItemsHandler: ${error}`)
      throw error
    }
  },
)

export const getMembershipHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const item = await db.membership.findUnique({
        where: { id },
        include: { benefits: true },
      })

      if (!item || !item.isActive) {
        throw new NotFoundException('Membership item not found')
      }

      return c.json(ok(item), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getMembershipHandler: ${error}`)
      throw error
    }
  },
)

export const getUserMembershipsHandler = factory.createHandlers(async (c) => {
  try {
    const user = c.get('user')

    if (!user) {
      return c.json(err('Unauthorized', status.UNAUTHORIZED))
    }

    const userMemberships = await db.membershipUser.findMany({
      where: {
        userId: user.id,
      },
      include: {
        membership: {
          include: {
            benefits: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Separate active, expired, and suspended memberships
    const now = new Date()
    const activeMemberships = userMemberships.filter(
      (um) =>
        !um.isExpired &&
        !um.isSuspended &&
        um.startDate <= now &&
        um.endDate > now,
    )
    const expiredMemberships = userMemberships.filter(
      (um) => um.isExpired || um.endDate <= now,
    )
    const suspendedMemberships = userMemberships.filter(
      (um) => um.isSuspended && !um.isExpired && um.endDate > now,
    )

    const response = {
      active: activeMemberships,
      expired: expiredMemberships,
      suspended: suspendedMemberships,
      total: userMemberships.length,
    }

    return c.json(
      ok(response, 'User memberships retrieved successfully'),
      status.OK,
    )
  } catch (error) {
    c.var.logger.fatal(`Error in getUserMembershipsHandler: ${error}`)
    throw error
  }
})

// GET /memberships/my/active
// Get logged-in user's active membership details
export const getMyActiveMembershipHandler = factory.createHandlers(
  async (c) => {
    try {
      const user = c.get('user')

      if (!user) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      // Find active membership
      const now = new Date()
      const activeMembership = await db.membershipUser.findFirst({
        where: {
          userId: user.id,
          isExpired: false,
          isSuspended: false,
          startDate: { lte: now }, // Membership must have started
          endDate: { gt: now }, // Membership must not have expired
          invoice: {
            status: InvoiceStatus.Paid, // Only paid memberships
          },
        },
        orderBy: {
          endDate: 'asc', // Get the one that expires first
        },
        include: {
          membership: {
            select: {
              id: true,
              name: true,
              price: true,
              sport: true,
              type: true,
            },
          },
        },
      })

      return c.json(
        ok({
          activeMembership: activeMembership
            ? {
                id: activeMembership.id,
                startDate: activeMembership.startDate,
                endDate: activeMembership.endDate,
                remainingSessions: activeMembership.remainingSessions,
                remainingDuration: activeMembership.remainingDuration,
                isExpired: activeMembership.isExpired,
                isSuspended: activeMembership.isSuspended,
                membership: {
                  id: activeMembership.membership.id,
                  name: activeMembership.membership.name,
                  price: activeMembership.membership.price,
                  sport: activeMembership.membership.sport,
                  type: activeMembership.membership.type,
                },
              }
            : null,
        }),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in getMyActiveMembershipHandler: ${error}`)
      throw error
    }
  },
)
