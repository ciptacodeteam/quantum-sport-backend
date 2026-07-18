import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
} from '@/lib/validation'
import { getFileUrl } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, CourtSport, PaymentStatus } from '@prisma/client'
import status from 'http-status'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import { z } from 'zod'

import { exportDataToExcel } from '@/services/analytics.service'
import { restoreMembershipSessionsForCancelledBooking } from '@/services/membership-booking.service'

// GET /admin/bookings
// Get all booking transactions
const bookingsQuerySchema = searchQuerySchema.extend({
  source: z
    .enum(['cashier', 'online'])
    .optional()
    .describe('Filter by booking source: cashier or online'),
  courtSport: z
    .nativeEnum(CourtSport)
    .optional()
    .describe('Filter by court sport: PADEL or TENNIS'),
  coach: z
    .enum(['with', 'without'])
    .optional()
    .describe('Filter bookings that include or do not include coach add-ons'),
})

const scheduleQuerySchema = searchQuerySchema.extend({
  courtSport: z
    .nativeEnum(CourtSport)
    .optional()
    .describe('Filter schedule by court sport: PADEL or TENNIS'),
})

export const getAllBookingTransactionsHandler = factory.createHandlers(
  zValidator('query', bookingsQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as any
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      let where = queryOptions.where || {}
      if (query.source) {
        if (query.source === 'cashier') {
          where = { ...where, cashierId: { not: null } }
        } else if (query.source === 'online') {
          where = { ...where, cashierId: null }
        }
      }
      if (query.courtSport) {
        where = {
          ...where,
          OR: [
            {
              details: {
                some: {
                  court: {
                    sport: query.courtSport,
                  },
                },
              },
            },
            ...(query.courtSport === CourtSport.TENNIS
              ? [
                  {
                    ballboys: {
                      some: {
                        status: {
                          not: BookingStatus.CANCELLED,
                        },
                        slot: {
                          isAvailable: false,
                        },
                      },
                    },
                  },
                ]
              : []),
          ],
        }
      }
      if (query.coach === 'with') {
        where = {
          ...where,
          coaches: {
            some: {},
          },
        }
      } else if (query.coach === 'without') {
        where = {
          ...where,
          coaches: {
            none: {},
          },
        }
      }

      const bookings = await db.booking.findMany({
        ...queryOptions,
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          cashier: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          details: {
            include: {
              court: {
                select: {
                  id: true,
                  name: true,
                  sport: true,
                },
              },
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                },
              },
            },
          },
          coaches: {
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                },
              },
              bookingCoachType: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          ballboys: {
            where: {
              status: {
                not: BookingStatus.CANCELLED,
              },
              slot: {
                isAvailable: false,
              },
            },
            include: {
              courtSlot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  court: {
                    select: {
                      id: true,
                      name: true,
                      sport: true,
                    },
                  },
                },
              },
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  staff: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      phone: true,
                      role: true,
                    },
                  },
                },
              },
            },
          },
          inventories: {
            include: {
              inventory: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          invoice: {
            include: {
              payment: {
                include: {
                  method: {
                    select: {
                      id: true,
                      name: true,
                      logo: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      return c.json(ok(bookings), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllBookingTransactionsHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/bookings/schedule
// Get all bookings with full coach and inventory details for schedule tab
export const getAllBookingScheduleHandler = factory.createHandlers(
  zValidator('query', scheduleQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema & {
        courtSport?: CourtSport
      }
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      let where = {
        ...queryOptions.where,
        status: {
          not: BookingStatus.CANCELLED,
        },
      } as any

      if (query.courtSport) {
        where = {
          ...where,
          OR: [
            {
              details: {
                some: {
                  court: {
                    sport: query.courtSport,
                  },
                },
              },
            },
            ...(query.courtSport === CourtSport.TENNIS
              ? [
                  {
                    ballboys: {
                      some: {
                        status: {
                          not: BookingStatus.CANCELLED,
                        },
                        slot: {
                          isAvailable: false,
                        },
                      },
                    },
                  },
                ]
              : []),
          ],
        }
      }

      const bookings = await db.booking.findMany({
        ...queryOptions,
        where,
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
          cashier: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          details: {
            include: {
              court: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  image: true,
                  sport: true,
                },
              },
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
                },
              },
            },
          },
          coaches: {
            select: {
              id: true,
              bookingId: true,
              slotId: true,
              bookingCoachTypeId: true,
              description: true,
              price: true,
              createdAt: true,
              updatedAt: true,
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
                  staff: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      phone: true,
                      image: true,
                      role: true,
                      coachType: true,
                      isActive: true,
                    },
                  },
                },
              },
              bookingCoachType: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
          ballboys: {
            where: {
              status: {
                not: BookingStatus.CANCELLED,
              },
              slot: {
                isAvailable: false,
              },
            },
            include: {
              courtSlot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  court: {
                    select: {
                      id: true,
                      name: true,
                      sport: true,
                    },
                  },
                },
              },
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
                  staff: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      phone: true,
                      image: true,
                      role: true,
                      isActive: true,
                    },
                  },
                },
              },
            },
          },
          inventories: {
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
            },
          },
          invoice: {
            include: {
              payment: {
                include: {
                  method: {
                    select: {
                      id: true,
                      name: true,
                      logo: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      // Process image URLs for user, court, and staff images
      for (const booking of bookings) {
        // Process user image
        if (booking.user.image) {
          booking.user.image = await getFileUrl(booking.user.image)
        }

        // Process court images
        for (const detail of booking.details) {
          if (detail.court?.image) {
            detail.court.image = await getFileUrl(detail.court.image)
          }
        }

        // Process coach staff images
        for (const coach of booking.coaches) {
          if (coach.slot.staff?.image) {
            coach.slot.staff.image = await getFileUrl(coach.slot.staff.image)
          }
        }

        // Process ballboy staff images
        for (const ballboy of booking.ballboys) {
          if (ballboy.slot.staff?.image) {
            ballboy.slot.staff.image = await getFileUrl(
              ballboy.slot.staff.image,
            )
          }
        }
      }

      // Format all datetime fields in bookings
      for (const booking of bookings) {
        // Format booking detail slots
        for (const detail of booking.details) {
          if (detail.slot?.startAt) {
            detail.slot.startAt = dayjs(detail.slot.startAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ) as any
          }
          if (detail.slot?.endAt) {
            detail.slot.endAt = dayjs(detail.slot.endAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ) as any
          }
        }

        // Format coach slots
        for (const coach of booking.coaches) {
          if (coach.slot?.startAt) {
            coach.slot.startAt = dayjs(coach.slot.startAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ) as any
          }
          if (coach.slot?.endAt) {
            coach.slot.endAt = dayjs(coach.slot.endAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ) as any
          }
        }

        // Format ballboy slots
        for (const ballboy of booking.ballboys) {
          if (ballboy.slot?.startAt) {
            ballboy.slot.startAt = dayjs(ballboy.slot.startAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ) as any
          }
          if (ballboy.slot?.endAt) {
            ballboy.slot.endAt = dayjs(ballboy.slot.endAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ) as any
          }
          if (ballboy.courtSlot?.startAt) {
            ballboy.courtSlot.startAt = dayjs(ballboy.courtSlot.startAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ) as any
          }
          if (ballboy.courtSlot?.endAt) {
            ballboy.courtSlot.endAt = dayjs(ballboy.courtSlot.endAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ) as any
          }
        }
      }

      return c.json(ok(bookings), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllBookingScheduleHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/bookings/:id
// Get booking transaction detail
export const getBookingTransactionDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const booking = await db.booking.findUnique({
        where: { id },
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
          cashier: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          details: {
            include: {
              court: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  image: true,
                },
              },
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
                },
              },
            },
          },
          coaches: {
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
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
              bookingCoachType: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
          ballboys: {
            where: {
              status: {
                not: BookingStatus.CANCELLED,
              },
              slot: {
                isAvailable: false,
              },
            },
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
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
            },
          },
          inventories: {
            include: {
              inventory: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  quantity: true,
                },
              },
            },
          },
          invoice: {
            include: {
              payment: {
                include: {
                  method: {
                    select: {
                      id: true,
                      name: true,
                      logo: true,
                      fees: true,
                      percentage: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!booking) {
        throw new NotFoundException('Booking not found')
      }

      return c.json(ok(booking), status.OK)
    } catch (error) {
      c.var.logger.fatal(
        `Error in getBookingTransactionDetailHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/bookings/:id/approve
// Approve booking transaction
export const approveBookingTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id },
          include: {
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!booking) {
          throw new NotFoundException('Booking not found')
        }

        if (booking.status === BookingStatus.CONFIRMED) {
          throw new BadRequestException('Booking is already confirmed')
        }

        if (booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException('Cannot approve cancelled booking')
        }

        // Update booking status to CONFIRMED
        const updatedBooking = await tx.booking.update({
          where: { id },
          data: {
            status: BookingStatus.CONFIRMED,
            holdExpiresAt: null, // Clear hold expiry
          },
        })

        // Update invoice status to PAID
        if (booking.invoice) {
          await tx.invoice.update({
            where: { id: booking.invoice.id },
            data: {
              status: PaymentStatus.PAID,
              paidAt: new Date(),
            },
          })

          // Update payment status to PAID
          if (booking.invoice.payment) {
            await tx.payment.update({
              where: { id: booking.invoice.payment.id },
              data: {
                status: PaymentStatus.PAID,
                paidAt: new Date(),
              },
            })
          }
        }

        return updatedBooking
      })

      return c.json(
        ok(result, 'Booking transaction approved successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in approveBookingTransactionHandler: ${error}`)
      throw error
    }
  },
)

// PUT /admin/bookings/:id/reject
// Reject booking transaction
export const rejectBookingTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id },
          include: {
            details: {
              include: {
                slot: true,
              },
            },
            coaches: {
              include: {
                slot: true,
              },
            },
            ballboys: {
              include: {
                slot: true,
              },
            },
            inventories: {
              include: {
                inventory: true,
              },
            },
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!booking) {
          throw new NotFoundException('Booking not found')
        }

        if (booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException('Booking is already cancelled')
        }

        if (booking.status === BookingStatus.CONFIRMED) {
          throw new BadRequestException(
            'Cannot reject confirmed booking. Please cancel it instead.',
          )
        }

        // Update booking status to CANCELLED
        const updatedBooking = await tx.booking.update({
          where: { id },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: 'Rejected by admin',
          },
        })

        // Release all court slots (make them available again)
        for (const detail of booking.details) {
          await tx.slot.update({
            where: { id: detail.slotId },
            data: {
              isAvailable: true,
            },
          })
        }

        // Release all coach slots
        for (const coach of booking.coaches) {
          await tx.slot.update({
            where: { id: coach.slotId },
            data: {
              isAvailable: true,
            },
          })
        }

        // Release all ballboy slots
        for (const ballboy of booking.ballboys) {
          await tx.slot.update({
            where: { id: ballboy.slotId },
            data: {
              isAvailable: true,
            },
          })
        }

        // Restore inventory quantities
        for (const bookingInventory of booking.inventories.filter(
          (inventory) => !inventory.returnedAt,
        )) {
          await tx.inventory.update({
            where: { id: bookingInventory.inventoryId },
            data: {
              quantity: {
                increment: bookingInventory.quantity,
              },
            },
          })
          await tx.bookingInventory.update({
            where: { id: bookingInventory.id },
            data: { returnedAt: new Date() },
          })
        }

        await restoreMembershipSessionsForCancelledBooking(tx, booking)

        // Update invoice status to CANCELLED
        if (booking.invoice) {
          await tx.invoice.update({
            where: { id: booking.invoice.id },
            data: {
              status: PaymentStatus.CANCELLED,
              cancelledAt: new Date(),
            },
          })

          // Update payment status to CANCELLED
          if (booking.invoice.payment) {
            await tx.payment.update({
              where: { id: booking.invoice.payment.id },
              data: {
                status: PaymentStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            })
          }
        }

        return updatedBooking
      })

      return c.json(
        ok(result, 'Booking transaction rejected successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in rejectBookingTransactionHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/bookings/export/excel
// Export booking transactions to Excel
export const exportBookingTransactionsToExcelHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      const bookings = await db.booking.findMany({
        ...queryOptions,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
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
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                },
              },
            },
          },
          coaches: {
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                },
              },
              bookingCoachType: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          ballboys: {
            where: {
              status: {
                not: BookingStatus.CANCELLED,
              },
              slot: {
                isAvailable: false,
              },
            },
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                },
              },
            },
          },
          inventories: {
            include: {
              inventory: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          invoice: {
            include: {
              payment: {
                include: {
                  method: {
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
      })

      // Transform bookings data to Excel format
      const excelData = bookings.map((booking) => {
        // Get courts info
        const courts = booking.details
          .map((d) => d.court?.name || 'N/A')
          .join(', ')
        const courtSlots = booking.details
          .map(
            (d) =>
              `${dayjs(d.slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(d.slot.endAt).format('HH:mm')}`,
          )
          .join(', ')

        // Get coaches info
        const coaches = booking.coaches
          .map((c) => c.bookingCoachType.name)
          .join(', ')
        const coachSlots = booking.coaches
          .map(
            (c) =>
              `${dayjs(c.slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(c.slot.endAt).format('HH:mm')}`,
          )
          .join(', ')

        // Get ballboys info
        const ballboySlots = booking.ballboys
          .map(
            (b) =>
              `${dayjs(b.slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(b.slot.endAt).format('HH:mm')}`,
          )
          .join(', ')

        // Get inventories info
        const inventories = booking.inventories
          .map((i) => `${i.inventory.name} (x${i.quantity})`)
          .join(', ')

        return {
          'Booking ID': booking.id,
          'Invoice Number': booking.invoice?.number || 'N/A',
          'Customer Name': booking.user.name,
          'Customer Email': booking.user.email || 'N/A',
          'Customer Phone': booking.user.phone,
          'Booking Status': booking.status,
          'Payment Status': booking.invoice?.status || 'N/A',
          'Payment Method': booking.invoice?.payment?.method.name || 'N/A',
          Courts: courts || 'N/A',
          'Court Slots': courtSlots || 'N/A',
          Coaches: coaches || 'N/A',
          'Coach Slots': coachSlots || 'N/A',
          'Ballboy Slots': ballboySlots || 'N/A',
          Inventories: inventories || 'N/A',
          'Total Price': booking.totalPrice,
          'Processing Fee': booking.processingFee,
          'Grand Total': booking.totalPrice + booking.processingFee,
          'Created At': dayjs(booking.createdAt).format('YYYY-MM-DD HH:mm:ss'),
          'Hold Expires At': booking.holdExpiresAt
            ? dayjs(booking.holdExpiresAt).format('YYYY-MM-DD HH:mm:ss')
            : 'N/A',
          'Cancelled At': booking.cancelledAt
            ? dayjs(booking.cancelledAt).format('YYYY-MM-DD HH:mm:ss')
            : 'N/A',
          'Cancellation Reason': booking.cancellationReason || 'N/A',
        }
      })

      // Create workbook and worksheet
      const worksheet = XLSX.utils.json_to_sheet(excelData)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Booking Transactions')

      // Set column widths for better readability
      const columnWidths = [
        { wch: 30 }, // Booking ID
        { wch: 25 }, // Invoice Number
        { wch: 25 }, // Customer Name
        { wch: 30 }, // Customer Email
        { wch: 20 }, // Customer Phone
        { wch: 15 }, // Booking Status
        { wch: 15 }, // Payment Status
        { wch: 20 }, // Payment Method
        { wch: 30 }, // Courts
        { wch: 40 }, // Court Slots
        { wch: 30 }, // Coaches
        { wch: 40 }, // Coach Slots
        { wch: 40 }, // Ballboy Slots
        { wch: 30 }, // Inventories
        { wch: 15 }, // Total Price
        { wch: 15 }, // Processing Fee
        { wch: 15 }, // Grand Total
        { wch: 20 }, // Created At
        { wch: 20 }, // Hold Expires At
        { wch: 20 }, // Cancelled At
        { wch: 30 }, // Cancellation Reason
      ]
      worksheet['!cols'] = columnWidths

      // Generate Excel buffer
      const excelBuffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      })

      // Generate filename with timestamp
      const filename = `booking-transactions-${dayjs().format('YYYY-MM-DD-HHmmss')}.xlsx`

      // Set headers for file download
      c.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      c.header('Content-Disposition', `attachment; filename="${filename}"`)

      return c.body(excelBuffer)
    } catch (error) {
      c.var.logger.fatal(
        `Error in exportBookingTransactionsToExcelHandler: ${error}`,
      )
      throw error
    }
  },
)

// GET /admin/bookings/export
// Export booking transactions to Excel using date range with enriched columns
const bookingsExportQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  source: z.enum(['cashier', 'online']).optional(),
  courtSport: z.nativeEnum(CourtSport).optional(),
  coach: z.enum(['with', 'without']).optional(),
})

export const exportBookingsHandler = factory.createHandlers(
  zValidator('query', bookingsExportQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as z.infer<
        typeof bookingsExportQuerySchema
      >
      const startDate = query.startDate
        ? dayjs(query.startDate).toDate()
        : undefined
      const endDate = query.endDate ? dayjs(query.endDate).toDate() : undefined

      const buffer = await exportDataToExcel(
        'bookings',
        startDate,
        endDate,
        query.source,
        query.courtSport,
        query.coach,
      )
      const filename = `bookings-export-${dayjs().format('YYYY-MM-DD')}.xlsx`

      c.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      c.header('Content-Disposition', `attachment; filename="${filename}"`)

      return c.body(buffer as any)
    } catch (error) {
      c.var.logger.fatal(`Error in exportBookingsHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/bookings/ongoing-schedule
// Get 20 nearest ongoing booking schedules starting from current time
export const getOngoingBookingScheduleHandler = factory.createHandlers(
  async (c) => {
    try {
      const now = dayjs().toDate()

      // Get confirmed bookings with slots that are happening now or in the near future
      const bookings = await db.booking.findMany({
        where: {
          status: BookingStatus.CONFIRMED,
          details: {
            some: {
              slot: {
                startAt: {
                  gte: dayjs().subtract(2, 'hours').toDate(), // Include slots that started up to 2 hours ago
                },
              },
            },
          },
        },
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
          cashier: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          details: {
            include: {
              court: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  image: true,
                },
              },
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
                },
              },
            },
          },
          coaches: {
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  staff: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      phone: true,
                      image: true,
                      role: true,
                    },
                  },
                },
              },
              bookingCoachType: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
          ballboys: {
            where: {
              status: {
                not: BookingStatus.CANCELLED,
              },
              slot: {
                isAvailable: false,
              },
            },
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  staff: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      phone: true,
                      image: true,
                      role: true,
                    },
                  },
                },
              },
            },
          },
          inventories: {
            include: {
              inventory: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
          invoice: {
            select: {
              id: true,
              number: true,
              status: true,
              total: true,
              paidAt: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      // Filter and transform bookings to include the nearest slot time
      const bookingsWithSchedule = bookings
        .map((booking) => {
          // Find the earliest slot time from all details
          const earliestSlot = booking.details.reduce(
            (earliest, detail) => {
              const slotStart = dayjs(detail.slot.startAt)
              return !earliest || slotStart.isBefore(dayjs(earliest))
                ? detail.slot.startAt
                : earliest
            },
            null as Date | null,
          )

          if (!earliestSlot) return null

          // Determine if booking is ongoing, upcoming, or completed
          const slotStart = dayjs(earliestSlot)
          const slotEnd = booking.details.find(
            (d) => d.slot.startAt.getTime() === earliestSlot.getTime(),
          )?.slot.endAt

          const scheduleStatus = slotStart.isAfter(now)
            ? 'upcoming'
            : slotEnd && dayjs(slotEnd).isAfter(now)
              ? 'ongoing'
              : 'completed'

          // Calculate time difference
          const minutesFromNow = slotStart.diff(dayjs(), 'minutes')
          const timeDisplay =
            minutesFromNow > 0
              ? `In ${minutesFromNow} minutes`
              : minutesFromNow === 0
                ? 'Now'
                : `Started ${Math.abs(minutesFromNow)} minutes ago`

          return {
            booking: {
              id: booking.id,
              userId: booking.userId,
              status: booking.status,
              totalPrice: booking.totalPrice,
              processingFee: booking.processingFee,
              createdAt: booking.createdAt,
            },
            user: booking.user,
            cashier: booking.cashier,
            schedule: {
              startAt: earliestSlot,
              endAt: slotEnd || earliestSlot,
              status: scheduleStatus,
              minutesFromNow,
              timeDisplay,
            },
            courts: booking.details.map((detail) => ({
              courtId: detail.court?.id,
              courtName: detail.court?.name,
              courtImage: detail.court?.image,
              slotStart: detail.slot.startAt,
              slotEnd: detail.slot.endAt,
              price: detail.price,
            })),
            coaches: booking.coaches.map((coach) => ({
              staffId: coach.slot.staff?.id,
              staffName: coach.slot.staff?.name,
              staffImage: coach.slot.staff?.image,
              coachType: coach.bookingCoachType.name,
              slotStart: coach.slot.startAt,
              slotEnd: coach.slot.endAt,
              price: coach.price,
            })),
            ballboys: booking.ballboys.map((ballboy) => ({
              staffId: ballboy.slot.staff?.id,
              staffName: ballboy.slot.staff?.name,
              staffImage: ballboy.slot.staff?.image,
              slotStart: ballboy.slot.startAt,
              slotEnd: ballboy.slot.endAt,
              price: ballboy.price,
            })),
            inventories: booking.inventories.map((inv) => ({
              inventoryId: inv.inventory.id,
              inventoryName: inv.inventory.name,
              quantity: inv.quantity,
              price: inv.price,
            })),
            invoice: booking.invoice,
          }
        })
        .filter(Boolean) // Remove any null entries
        .sort((a, b) => {
          // Sort by closest to current time (considering both ongoing and upcoming)
          const aMinutes = Math.abs(a!.schedule.minutesFromNow)
          const bMinutes = Math.abs(b!.schedule.minutesFromNow)
          return aMinutes - bMinutes
        })
        .slice(0, 20) // Take only 20 nearest bookings

      return c.json(
        ok(
          bookingsWithSchedule,
          `Found ${bookingsWithSchedule.length} ongoing/upcoming bookings`,
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in getOngoingBookingScheduleHandler: ${error}`)
      throw error
    }
  },
)
