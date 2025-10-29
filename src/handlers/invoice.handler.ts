import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { SearchQuerySchema, searchQuerySchema } from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

// GET /invoices
export const getUserInvoicesHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        throw new Error('Unauthorized')
      }

      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { issuedAt: 'desc' },
        searchableFields: ['status', 'dueDate'],
      })

      const invoices = await db.invoice.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          userId: user.id,
        },
        include: {
          booking: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              createdAt: true,
            },
          },
          classBooking: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              class: { select: { id: true, name: true } },
            },
          },
          membershipUser: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              membership: { select: { id: true, name: true } },
            },
          },
        },
      })

      return c.json(ok(invoices), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getUserInvoicesHandler: ${error}`)
      throw error
    }
  },
)
