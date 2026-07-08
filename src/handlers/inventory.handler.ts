import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import {
  availableInventoryQuerySchema,
  AvailableInventoryQuerySchema,
} from '@/lib/validation'
import { getInventoryAvailability } from '@/services/inventory-availability.service'

// GET /inventories/availability
// Returns all active inventory items with their current stock
export const getAvailableInventoryHandler = factory.createHandlers(
  zValidator('query', availableInventoryQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as AvailableInventoryQuerySchema
      const availableInventories = await getInventoryAvailability(db, query)

      return c.json(ok(availableInventories), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAvailableInventoryHandler: ${error}`)
      throw error
    }
  },
)
