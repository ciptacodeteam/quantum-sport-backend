import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { IdSchema, idSchema, searchQuerySchema } from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'

// Schema for cancel booking request
const cancelBookingSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required').optional(),
})

type CancelBookingSchema = z.infer<typeof cancelBookingSchema>

// GET /admin/booked-inventories
// Get all booked inventories
const bookedInventoriesQuerySchema = searchQuerySchema.extend({
  source: z
    .enum(['cashier', 'online'])
    .optional()
    .describe('Filter by booking source: cashier or online'),
})

export const getAllBookedInventoriesHandler = factory.createHandlers(
  zValidator('query', bookedInventoriesQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as any
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      // Add source filter if provided
      let where = queryOptions.where || {}
      if (query.source) {
        if (query.source === 'cashier') {
          where = { ...where, booking: { cashierId: { not: null } } }
        } else if (query.source === 'online') {
          where = { ...where, booking: { cashierId: null } }
        }
      }

      const bookedInventories = await db.bookingInventory.findMany({
        ...queryOptions,
        where,
        include: {
          inventory: {
            select: {
              id: true,
              name: true,
              description: true,
              quantity: true,
              price: true,
              isActive: true,
            },
          },
          booking: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  image: true,
                },
              },
              invoice: {
                select: {
                  id: true,
                  number: true,
                  status: true,
                  total: true,
                },
              },
              details: {
                include: {
                  court: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                  slot: {
                    select: {
                      startAt: true,
                      endAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      const formattedInventories = bookedInventories.map((inv) => ({
        id: inv.id,
        inventory: inv.inventory,
        quantity: inv.quantity,
        unitPrice: inv.price,
        totalPrice: inv.price * inv.quantity,
        booking: {
          id: inv.booking.id,
          status: inv.booking.status,
          totalPrice: inv.booking.totalPrice,
          customer: inv.booking.user,
          invoice: inv.booking.invoice,
          courtSlots: inv.booking.details.map((d) => ({
            court: d.court,
            startAt: d.slot.startAt,
            endAt: d.slot.endAt,
            date: dayjs(d.slot.startAt).format('YYYY-MM-DD'),
            time: `${dayjs(d.slot.startAt).format('HH:mm')} - ${dayjs(d.slot.endAt).format('HH:mm')}`,
          })),
          createdAt: inv.booking.createdAt,
        },
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
      }))

      return c.json(ok(formattedInventories), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllBookedInventoriesHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/booked-inventories/:id
// Get detailed information about a specific booked inventory
export const getBookedInventoryDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const inventory = await db.bookingInventory.findUnique({
        where: { id },
        include: {
          inventory: true,
          booking: {
            include: {
              user: true,
              invoice: {
                include: {
                  payment: {
                    include: {
                      method: true,
                    },
                  },
                },
              },
              details: {
                include: {
                  court: true,
                  slot: true,
                },
              },
              coaches: {
                include: {
                  slot: {
                    include: {
                      staff: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                  },
                  bookingCoachType: true,
                },
              },
              ballboys: {
                include: {
                  slot: {
                    include: {
                      staff: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!inventory) {
        return c.json(ok(null, 'Booked inventory not found'), status.NOT_FOUND)
      }

      const detailedInventory = {
        id: inventory.id,
        inventory: inventory.inventory,
        quantity: inventory.quantity,
        unitPrice: inventory.price,
        totalPrice: inventory.price * inventory.quantity,
        booking: {
          ...inventory.booking,
          courtSlots: inventory.booking.details.map((d) => ({
            court: d.court,
            slot: {
              ...d.slot,
              date: dayjs(d.slot.startAt).format('YYYY-MM-DD'),
              startTime: dayjs(d.slot.startAt).format('HH:mm'),
              endTime: dayjs(d.slot.endAt).format('HH:mm'),
            },
          })),
          coaches: inventory.booking.coaches.map((c) => ({
            staff: c.slot.staff,
            coachType: c.bookingCoachType,
            slot: {
              startAt: c.slot.startAt,
              endAt: c.slot.endAt,
            },
          })),
          ballboys: inventory.booking.ballboys.map((b) => ({
            staff: b.slot.staff,
            slot: {
              startAt: b.slot.startAt,
              endAt: b.slot.endAt,
            },
          })),
        },
        createdAt: inventory.createdAt,
        updatedAt: inventory.updatedAt,
      }

      return c.json(ok(detailedInventory), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getBookedInventoryDetailHandler: ${error}`)
      throw error
    }
  },
)

// PUT /admin/booked-inventories/:id/cancel
// Cancel a specific inventory booking
export const cancelInventoryBookingHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', cancelBookingSchema, validateHook),
  async (c) => {
    try {
      const { id: inventoryBookingId } = c.req.valid('param') as IdSchema
      const { reason } = c.req.valid('json') as CancelBookingSchema

      const result = await db.$transaction(async (tx) => {
        // 1. Fetch the inventory booking
        const inventoryBooking = await tx.bookingInventory.findUnique({
          where: { id: inventoryBookingId },
          include: {
            inventory: {
              select: {
                id: true,
                name: true,
                quantity: true,
              },
            },
            booking: {
              include: {
                invoice: true,
              },
            },
          },
        })

        if (!inventoryBooking) {
          throw new NotFoundException('Inventory booking not found')
        }

        // 2. Check if the main booking is already cancelled
        if (inventoryBooking.booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException(
            'Cannot cancel inventory booking - main booking is already cancelled',
          )
        }

        // 3. Restore inventory quantity if this session has not returned it yet
        if (!inventoryBooking.returnedAt) {
          await tx.inventory.update({
            where: { id: inventoryBooking.inventoryId },
            data: {
              quantity: {
                increment: inventoryBooking.quantity,
              },
            },
          })
        }

        // 4. Calculate the total price of this inventory booking
        const totalInventoryPrice =
          inventoryBooking.price * inventoryBooking.quantity

        // 5. Delete the inventory booking
        await tx.bookingInventory.delete({
          where: { id: inventoryBookingId },
        })

        // 6. Update the main booking total price (subtract inventory price)
        const updatedBooking = await tx.booking.update({
          where: { id: inventoryBooking.bookingId },
          data: {
            totalPrice: {
              decrement: totalInventoryPrice,
            },
          },
        })

        // 7. Update invoice if exists
        if (inventoryBooking.booking.invoice) {
          await tx.invoice.update({
            where: { id: inventoryBooking.booking.invoice.id },
            data: {
              subtotal: {
                decrement: totalInventoryPrice,
              },
              total: {
                decrement: totalInventoryPrice,
              },
            },
          })
        }

        return {
          inventoryBooking,
          updatedBooking,
          restoredQuantity: inventoryBooking.quantity,
        }
      })

      return c.json(
        ok(
          {
            cancelledInventory: {
              id: result.inventoryBooking.id,
              inventory: result.inventoryBooking.inventory,
              quantity: result.inventoryBooking.quantity,
              unitPrice: result.inventoryBooking.price,
              totalPrice:
                result.inventoryBooking.price *
                result.inventoryBooking.quantity,
              restoredQuantity: result.restoredQuantity,
            },
            updatedBooking: {
              id: result.updatedBooking.id,
              totalPrice: result.updatedBooking.totalPrice,
            },
            reason: reason || 'Cancelled by admin',
          },
          'Inventory booking cancelled successfully. Stock has been restored.',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in cancelInventoryBookingHandler: ${error}`)
      throw error
    }
  },
)
