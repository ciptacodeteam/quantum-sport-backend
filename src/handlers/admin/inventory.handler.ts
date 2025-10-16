import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import {
  CreateInventorySchema,
  IdSchema,
  SearchQuerySchema,
} from '@/lib/validation'
import buildFindManyOptions from '@/lib/query'
import { AppRouteHandler } from '@/types'
import status from 'http-status'
import { NotFoundException } from '@/exceptions'

export const getAllInventoryHandler: AppRouteHandler = async (c) => {
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

export const getInventoryHandler: AppRouteHandler = async (c) => {
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

    return c.json(ok(newItem), status.CREATED)
  } catch (error) {
    c.var.logger.fatal(`Error in createInventory: ${error}`)
    throw error
  }
}

export const updateInventoryHandler: AppRouteHandler = async (c) => {
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
}

export const deleteInventoryHandler: AppRouteHandler = async (c) => {
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
}
