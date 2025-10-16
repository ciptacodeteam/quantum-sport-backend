import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { err, ok } from '@/lib/response'
import {
  createInventorySchema,
  CreateInventorySchema,
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
  updateInventorySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getAllInventoryHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
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
  },
)

export const getInventoryHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const item = await db.inventory.findUnique({
        where: { id },
      })

      if (!item) {
        throw new NotFoundException('Inventory item not found')
      }

      return c.json(ok(item), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getInventoryHandler: ${error}`)
      throw error
    }
  },
)

export const createInventoryHandler = factory.createHandlers(
  zValidator('json', createInventorySchema, validateHook),
  async (c) => {
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

      return c.json(ok(newItem), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createInventory: ${error}`)
      throw error
    }
  },
)

export const updateInventoryHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateInventorySchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const body = c.req.valid('json') as Partial<CreateInventorySchema>

      const existingItem = await db.inventory.findUnique({
        where: { id },
      })

      if (!existingItem) {
        throw new NotFoundException('Inventory item not found')
      }

      const updatedItem = await db.inventory.update({
        where: { id },
        data: body,
      })

      return c.json(ok(updatedItem), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateInventoryHandler: ${error}`)
      throw error
    }
  },
)

export const deleteInventoryHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const existingItem = await db.inventory.findUnique({
        where: { id },
      })

      if (!existingItem) {
        throw new NotFoundException('Inventory item not found')
      }

      const isUsedInOrders = await db.bookingInventory.findFirst({
        where: { inventoryId: id },
      })

      if (isUsedInOrders) {
        return c.json(
          err(
            'Cannot delete inventory item as it is associated with existing orders.',
            status.BAD_REQUEST,
          ),
          status.BAD_REQUEST,
        )
      }

      await db.inventory.delete({
        where: { id },
      })

      return c.json(ok(null, 'Inventory item deleted'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in deleteInventoryHandler: ${error}`)
      throw error
    }
  },
)
