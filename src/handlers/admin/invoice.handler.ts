import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { SearchQuerySchema, searchQuerySchema } from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { formatClubWallClock } from '@/lib/club-time'
import { z } from 'zod'

const idSchema = z.object({ id: z.string() })
type IdSchema = z.infer<typeof idSchema>

function invoiceScheduleSlot<T extends { startAt: Date; endAt: Date }>(
  slot: T,
) {
  return {
    ...slot,
    startAt: formatClubWallClock(slot.startAt),
    endAt: formatClubWallClock(slot.endAt),
    date: formatClubWallClock(slot.startAt, 'YYYY-MM-DD'),
    startTime: formatClubWallClock(slot.startAt, 'HH:mm'),
    endTime: formatClubWallClock(slot.endAt, 'HH:mm'),
  }
}

export const getAllInvoicesAdminHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    const query = c.req.valid('query') as SearchQuerySchema
    const queryOptions = buildFindManyOptions(query, {
      defaultOrderBy: { issuedAt: 'desc' },
      searchableFields: ['number'],
    })

    const invoices = await db.invoice.findMany({
      ...queryOptions,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
        payment: {
          select: {
            id: true,
            status: true,
            amount: true,
            fees: true,
            dueDate: true,
            paidAt: true,
          },
        },
        booking: {
          select: { id: true, status: true, totalPrice: true },
        },
        classBooking: {
          select: { id: true, status: true, totalPrice: true },
        },
        membershipUser: {
          select: { id: true },
        },
      },
    })

    const data = invoices.map((inv) => {
      const type = inv.bookingId
        ? 'BOOKING'
        : inv.classBookingId
          ? 'CLASS_BOOKING'
          : inv.membershipUserId
            ? 'MEMBERSHIP'
            : 'UNKNOWN'
      return {
        id: inv.id,
        number: inv.number,
        type,
        user: inv.user,
        subtotal: inv.subtotal,
        processingFee: inv.processingFee,
        // promoCodeText: inv.promoCodeText,
        promoDiscountAmount: inv.promoDiscountAmount,
        total: inv.total,
        status: inv.status,
        issuedAt: inv.issuedAt,
        dueDate: inv.dueDate,
        paidAt: inv.paidAt,
        paymentStatus: inv.payment?.status ?? inv.status,
        paymentId: inv.payment?.id ?? null,
        related: {
          bookingId: inv.booking?.id ?? null,
          classBookingId: inv.classBooking?.id ?? null,
          membershipUserId: inv.membershipUser?.id ?? null,
        },
      }
    })

    return c.json(ok(data), status.OK)
  },
)

export const getInvoiceDetailAdminHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param') as IdSchema

    const invoice = await db.invoice.findUnique({
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
        payment: true,
        booking: {
          select: {
            id: true,
            status: true,
            totalPrice: true,
            processingFee: true,
            courtNormalPrice: true,
            courtDiscountPrice: true,
            membershipUserId: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
            details: {
              include: {
                court: { select: { id: true, name: true, image: true } },
                slot: true,
              },
            },
            coaches: {
              include: {
                slot: {
                  include: {
                    staff: { select: { id: true, name: true, phone: true } },
                  },
                },
                bookingCoachType: true,
              },
            },
            ballboys: {
              include: {
                slot: {
                  include: {
                    staff: { select: { id: true, name: true, phone: true } },
                  },
                },
              },
            },
            inventories: {
              include: {
                inventory: { select: { id: true, name: true, price: true } },
              },
            },
          },
        },
        classBooking: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
            class: true,
            details: true,
          },
        },
        membershipUser: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
            membership: true,
          },
        },
      },
    })

    if (!invoice) {
      throw new NotFoundException('Invoice not found')
    }

    const type = invoice.bookingId
      ? 'BOOKING'
      : invoice.classBookingId
        ? 'CLASS_BOOKING'
        : invoice.membershipUserId
          ? 'MEMBERSHIP'
          : 'UNKNOWN'

    const response = {
      id: invoice.id,
      number: invoice.number,
      type,
      user: invoice.user,
      subtotal: invoice.subtotal,
      processingFee: invoice.processingFee,
      // promoCodeText: invoice.promoCodeText,
      promoDiscountAmount: invoice.promoDiscountAmount,
      total: invoice.total,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      cancelledAt: invoice.cancelledAt,
      payment: invoice.payment,
      booking: invoice.booking && {
        ...invoice.booking,
        courts: invoice.booking.details.map((d) => ({
          court: d.court,
          slot: invoiceScheduleSlot(d.slot),
          price: d.price,
          discountPrice: d.discountPrice,
        })),
        coaches: invoice.booking.coaches.map((c) => ({
          staff: c.slot.staff,
          coachType: c.bookingCoachType,
          slot: invoiceScheduleSlot(c.slot),
          price: c.price,
        })),
        ballboys: invoice.booking.ballboys.map((b) => ({
          staff: b.slot.staff,
          slot: invoiceScheduleSlot(b.slot),
          price: b.price,
        })),
        inventories: invoice.booking.inventories.map((i) => ({
          inventory: i.inventory,
          quantity: i.quantity,
          price: i.price,
        })),
      },
      classBooking: invoice.classBooking,
      membership: invoice.membershipUser
        ? {
            ...invoice.membershipUser,
            // keep structure explicit for readability on client side
          }
        : null,
    }

    return c.json(ok(response), status.OK)
  },
)
