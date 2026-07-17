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
  category: z
    .enum(['all', 'bola', 'raket', 'ballboy', 'coach', 'inventory'])
    .optional()
    .describe('Filter add-ons by category'),
})

function getInventoryCategory(name: string) {
  const normalized = name.toLowerCase()

  if (normalized.includes('bola') || normalized.includes('ball')) {
    return 'bola'
  }
  if (normalized.includes('raket') || normalized.includes('racket')) {
    return 'raket'
  }

  return 'inventory'
}

function buildCourtSlots(
  details: Array<{
    court: { id: string; name: string } | null
    slot: { startAt: Date; endAt: Date }
  }>,
) {
  return details.map((d) => ({
    court: d.court,
    startAt: d.slot.startAt,
    endAt: d.slot.endAt,
    date: dayjs(d.slot.startAt).format('YYYY-MM-DD'),
    time: `${dayjs(d.slot.startAt).format('HH:mm')} - ${dayjs(d.slot.endAt).format('HH:mm')}`,
  }))
}

export const getAllBookedInventoriesHandler = factory.createHandlers(
  zValidator('query', bookedInventoriesQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as any
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })
      const category = query.category || 'all'

      // Add source filter if provided
      let where = queryOptions.where || {}
      if (query.source) {
        if (query.source === 'cashier') {
          where = { ...where, booking: { cashierId: { not: null } } }
        } else if (query.source === 'online') {
          where = { ...where, booking: { cashierId: null } }
        }
      }

      const includeInventory =
        category === 'all' ||
        category === 'inventory' ||
        category === 'bola' ||
        category === 'raket'
      const includeBallboys = category === 'all' || category === 'ballboy'
      const includeCoaches = category === 'all' || category === 'coach'

      const bookingInclude = {
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
      }

      const [bookedInventories, bookedBallboys, bookedCoaches] =
        await Promise.all([
          includeInventory
            ? db.bookingInventory.findMany({
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
                    include: bookingInclude,
                  },
                },
              })
            : Promise.resolve([]),
          includeBallboys
            ? db.bookingBallboy.findMany({
                where,
                include: {
                  slot: {
                    include: {
                      staff: {
                        select: {
                          id: true,
                          name: true,
                          email: true,
                          phone: true,
                        },
                      },
                    },
                  },
                  booking: {
                    include: bookingInclude,
                  },
                },
              })
            : Promise.resolve([]),
          includeCoaches
            ? db.bookingCoach.findMany({
                where,
                include: {
                  slot: {
                    include: {
                      staff: {
                        select: {
                          id: true,
                          name: true,
                          email: true,
                          phone: true,
                        },
                      },
                    },
                  },
                  bookingCoachType: true,
                  booking: {
                    include: bookingInclude,
                  },
                },
              })
            : Promise.resolve([]),
        ])

      const formattedInventories = bookedInventories
        .map((inv) => ({
        id: inv.id,
        itemType: 'inventory',
        category: getInventoryCategory(inv.inventory.name),
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
          courtSlots: buildCourtSlots(inv.booking.details),
          createdAt: inv.booking.createdAt,
        },
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
      }))
        .filter((inv) =>
          category === 'all' || category === 'inventory'
            ? true
            : inv.category === category,
        )

      const formattedBallboys = bookedBallboys.map((ballboy) => ({
        id: ballboy.id,
        itemType: 'ballboy',
        category: 'ballboy',
        inventory: {
          id: ballboy.slot.staff?.id || ballboy.slot.id,
          name: ballboy.slot.staff?.name
            ? `Ballboy - ${ballboy.slot.staff.name}`
            : 'Ballboy',
          description: 'Ballboy add-on',
          quantity: 1,
          price: ballboy.price,
          isActive: true,
        },
        serviceStaff: ballboy.slot.staff,
        slot: {
          startAt: ballboy.slot.startAt,
          endAt: ballboy.slot.endAt,
        },
        quantity: 1,
        unitPrice: ballboy.price,
        totalPrice: ballboy.price,
        booking: {
          id: ballboy.booking.id,
          status: ballboy.booking.status,
          totalPrice: ballboy.booking.totalPrice,
          customer: ballboy.booking.user,
          invoice: ballboy.booking.invoice,
          courtSlots: buildCourtSlots(ballboy.booking.details),
          createdAt: ballboy.booking.createdAt,
        },
        createdAt: ballboy.createdAt,
        updatedAt: ballboy.updatedAt,
      }))

      const formattedCoaches = bookedCoaches.map((coach) => ({
        id: coach.id,
        itemType: 'coach',
        category: 'coach',
        inventory: {
          id: coach.slot.staff?.id || coach.slot.id,
          name: coach.slot.staff?.name
            ? `Coach - ${coach.slot.staff.name}`
            : 'Coach',
          description: coach.bookingCoachType.name,
          quantity: 1,
          price: coach.price,
          isActive: true,
        },
        serviceStaff: coach.slot.staff,
        coachType: coach.bookingCoachType,
        slot: {
          startAt: coach.slot.startAt,
          endAt: coach.slot.endAt,
        },
        quantity: 1,
        unitPrice: coach.price,
        totalPrice: coach.price,
        booking: {
          id: coach.booking.id,
          status: coach.booking.status,
          totalPrice: coach.booking.totalPrice,
          customer: coach.booking.user,
          invoice: coach.booking.invoice,
          courtSlots: buildCourtSlots(coach.booking.details),
          createdAt: coach.booking.createdAt,
        },
        createdAt: coach.createdAt,
        updatedAt: coach.updatedAt,
      }))

      const combinedItems = [
        ...formattedInventories,
        ...formattedBallboys,
        ...formattedCoaches,
      ].sort(
        (a, b) =>
          dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf(),
      )

      const skip = queryOptions.skip || 0
      const take = queryOptions.take
      const paginatedItems =
        take === undefined ? combinedItems : combinedItems.slice(skip, skip + take)

      return c.json(ok(paginatedItems), status.OK)
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
