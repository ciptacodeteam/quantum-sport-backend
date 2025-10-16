import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { CreateInventorySchema, SearchQuerySchema } from '@/lib/validation'
import buildFindManyOptions from '@/lib/query'
import { AppRouteHandler } from '@/types'
import status from 'http-status'

export const getInventoryItemsHandler: AppRouteHandler = async (c) => {
  try {
    const query = c.req.valid('query') as SearchQuerySchema
    const queryOptions = buildFindManyOptions(query, {
      defaultOrderBy: { createdAt: 'desc' },
      searchableFields: ['name', 'description'],
    })

    const items = await db.inventory.findMany({
      ...queryOptions,
    })
    return c.json(ok(items), status.OK)
  } catch (error) {
    c.var.logger.fatal(`Error in getInventoryItemsHandler: ${error}`)
    throw error
  }
}

export const createInventoryHandler: AppRouteHandler = async (c) => {
  try {
    const body = c.req.valid('json') as CreateInventorySchema
    const { name, description, quantity } = body

    const newItem = await db.inventory.create({
      data: {
        name,
        description,
        quantity,
      },
    })

    return c.json(ok(newItem), status.OK)
  } catch (error) {
    c.var.logger.fatal(`Error in createInventory: ${error}`)
    throw error
  }
}
