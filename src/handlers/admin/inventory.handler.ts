import { INVENTORY_SUBDIR } from '@/config'
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
import { getInventoryAvailability } from '@/services/inventory-availability.service'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getInventoryAvailabilityHandler = factory.createHandlers(
  zValidator('query', availableInventoryQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as AvailableInventoryQuerySchema

      const availability = await getInventoryAvailability(db, query)

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

      for (const item of items) {
        if (item.image) {
          item.image = await getFileUrl(item.image)
        }
      }

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

      if (item.image) {
        item.image = await getFileUrl(item.image)
      }

      return c.json(ok(item), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getInventoryHandler: ${error}`)
      throw error
    }
  },
)

export const createInventoryHandler = factory.createHandlers(
  zValidator('form', createInventorySchema, validateHook),
  async (c) => {
    try {
      const body = c.req.valid('form') as CreateInventorySchema
      const { name, description, image, sport, quantity, price, isActive } =
        body

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

      let imageUrl: string | undefined

      if (image) {
        const uploaded = await uploadFile(image, {
          subdir: INVENTORY_SUBDIR,
        })
        imageUrl = uploaded.relativePath
      }

      const newItem = await db.inventory.create({
        data: {
          name,
          description,
          image: imageUrl,
          sport,
          quantity,
          price,
          isActive,
        },
      })

      if (newItem.image) {
        newItem.image = await getFileUrl(newItem.image)
      }

      return c.json(ok(newItem), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createInventory: ${error}`)
      throw error
    }
  },
)

export const updateInventoryHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateInventorySchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const body = c.req.valid('form') as Partial<CreateInventorySchema>
      const { image, ...inventoryData } = body

      const existingItem = await db.inventory.findUnique({
        where: { id },
      })

      if (!existingItem) {
        throw new NotFoundException('Inventory item not found')
      }

      let imageUrl = existingItem.image

      if (image) {
        if (existingItem.image) {
          const oldImageUrl = await getFileUrl(existingItem.image)
          const deleted = await deleteFile(oldImageUrl)
          if (deleted) {
            c.var.logger.info(
              `Old image deleted for inventory ID: ${existingItem.id}`,
            )
          } else {
            c.var.logger.warn(
              `Failed to delete old image for inventory ID: ${existingItem.id}`,
            )
          }
        }

        const uploaded = await uploadFile(image, {
          subdir: INVENTORY_SUBDIR,
        })
        imageUrl = uploaded.relativePath
      }

      const updatedItem = await db.inventory.update({
        where: { id },
        data: {
          ...inventoryData,
          image: imageUrl,
        },
      })

      if (updatedItem.image) {
        updatedItem.image = await getFileUrl(updatedItem.image)
      }

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

      if (existingItem.image) {
        const imageUrl = await getFileUrl(existingItem.image)
        const deleted = await deleteFile(imageUrl)
        if (deleted) {
          c.var.logger.info(
            `Image deleted for inventory ID: ${existingItem.id}`,
          )
        } else {
          c.var.logger.warn(
            `Failed to delete image for inventory ID: ${existingItem.id}`,
          )
        }
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
