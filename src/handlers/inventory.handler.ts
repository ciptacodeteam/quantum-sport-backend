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

// GET /inventories/availability
// Returns all active inventory items with their current stock
export const getAvailableInventoryHandler = factory.createHandlers(
  zValidator('query', availableInventoryQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as AvailableInventoryQuerySchema
      // Get all active inventory items
      const inventories = await db.inventory.findMany({
        where: {
          isActive: true,
          ...(query.courtSport ? { sport: query.courtSport } : {}),
        },
        orderBy: {
          name: 'asc',
        },
      })

      // Return remaining stock directly (stock is decremented immediately on checkout)
      const availableInventories = inventories
        .map((inventory) => ({
          id: inventory.id,
          name: inventory.name,
          description: inventory.description,
          sport: inventory.sport,
          price: inventory.price,
          totalQuantity: inventory.quantity,
          availableQuantity: inventory.quantity, // Remaining stock
        }))
        .filter((inv) => inv.availableQuantity > 0)

      // Filter out items with zero availability
      const filteredInventories = availableInventories.filter(
        (inv) => inv.availableQuantity > 0,
      )

      return c.json(ok(filteredInventories), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAvailableInventoryHandler: ${error}`)
      throw error
    }
  },
)
