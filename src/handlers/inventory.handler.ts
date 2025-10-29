import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { availableInventoryQuerySchema } from '@/lib/validation'
import { BookingStatus } from '@prisma/client'

// GET /inventories/availability
// Returns all active inventory items with their current stock
export const getAvailableInventoryHandler = factory.createHandlers(
  zValidator('query', availableInventoryQuerySchema, validateHook),
  async (c) => {
    try {
      // validated but currently unused; kept for parity with schedule selection
      c.req.valid('query')
      // Get all active inventory items
      const inventories = await db.inventory.findMany({
        where: {
          isActive: true,
        },
        orderBy: {
          name: 'asc',
        },
      })

      // For each inventory, check current available stock
      // by subtracting booked quantities from total quantity
      const availableInventories = await Promise.all(
        inventories.map(async (inventory) => {
          // Get all bookings for this inventory
          const bookings = await db.bookingInventory.findMany({
            where: {
              inventoryId: inventory.id,
              booking: {
                status: {
                  in: [BookingStatus.CONFIRMED, BookingStatus.HOLD],
                },
              },
            },
          })

          // Calculate total booked quantity
          const bookedQuantity = bookings.reduce(
            (sum, booking) => sum + booking.quantity,
            0,
          )

          // Available stock = total quantity - booked quantity
          const availableQuantity = Math.max(
            0,
            inventory.quantity - bookedQuantity,
          )

          return {
            id: inventory.id,
            name: inventory.name,
            description: inventory.description,
            totalQuantity: inventory.quantity,
            availableQuantity,
            bookedQuantity,
          }
        }),
      )

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
