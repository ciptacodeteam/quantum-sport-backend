import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { err, ok } from '@/lib/response'
import {
  availableInventoryQuerySchema,
  AvailableInventoryQuerySchema,
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

export const getInventoryAvailabilityHandler = factory.createHandlers(
  zValidator('query', availableInventoryQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as AvailableInventoryQuerySchema

      const inventories = await db.inventory.findMany({
        where: {
          isActive: true,
          ...(query.courtSport ? { sport: query.courtSport } : {}),
        },
        orderBy: {
          name: 'asc',
        },
      })

      const availability = inventories
        .map((inventory) => ({
          id: inventory.id,
          name: inventory.name,
          description: inventory.description,
          sport: inventory.sport,
          price: inventory.price,
          totalQuantity: inventory.quantity,
          availableQuantity: inventory.quantity, // Remaining stock
        }))
        .filter((item) => item.availableQuantity > 0)

      return c.json(ok(availability), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getInventoryAvailabilityHandler: ${error}`)
      throw error
    }
  },
)

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
      const { name, description, sport, quantity, price } = body

      const existingName = await db.inventory.findFirst({
        where: { name },
      })

      if (existingName) {
        return c.json(
          err(
            'Inventory item with this name already exists.',
            status.BAD_REQUEST,
          ),
          status.BAD_REQUEST,
        )
      }

      const newItem = await db.inventory.create({
        data: {
          name,
          description,
          sport,
          quantity,
          price,
          isActive: true,
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
