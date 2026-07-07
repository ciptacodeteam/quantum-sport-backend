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
import { zValidator } from '@hono/zod-validator'
import { CourtSport, PaymentStatus } from '@prisma/client'
import status from 'http-status'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import { z } from 'zod'

// GET /admin/membership-transactions
// Get all membership transactions
const membershipTransactionsQuerySchema = searchQuerySchema.extend({
  source: z
    .enum(['cashier', 'online'])
    .optional()
    .describe('Filter by transaction source: cashier or online'),
  sport: z.nativeEnum(CourtSport).optional(),
})

export const getAllMembershipTransactionsHandler = factory.createHandlers(
  zValidator('query', membershipTransactionsQuerySchema, validateHook),
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
          where = {
            ...where,
            invoice: { booking: { cashierId: { not: null } } },
          }
        } else if (query.source === 'online') {
          where = { ...where, invoice: { booking: { cashierId: null } } }
        }
      }
      if (query.sport) {
        where = {
          ...where,
          membership: {
            sport: query.sport,
          },
        }
      }

      const membershipTransactions = await db.membershipUser.findMany({
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
          membership: {
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              sport: true,
              sessions: true,
              duration: true,
              benefits: {
                select: {
                  id: true,
                  benefit: true,
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

      return c.json(ok(membershipTransactions), status.OK)
    } catch (error) {
      c.var.logger.fatal(
        `Error in getAllMembershipTransactionsHandler: ${error}`,
      )
      throw error
    }
  },
)

// GET /admin/membership-transactions/:id
// Get membership transaction detail
export const getMembershipTransactionDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const membershipTransaction = await db.membershipUser.findUnique({
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
          membership: {
            select: {
              id: true,
              name: true,
              description: true,
              content: true,
              price: true,
              sport: true,
              sessions: true,
              duration: true,
              benefits: {
                select: {
                  id: true,
                  benefit: true,
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

      if (!membershipTransaction) {
        throw new NotFoundException('Membership transaction not found')
      }

      return c.json(ok(membershipTransaction), status.OK)
    } catch (error) {
      c.var.logger.fatal(
        `Error in getMembershipTransactionDetailHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/membership-transactions/:id/approve
// Approve membership transaction (update invoice/payment status)
export const approveMembershipTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const membershipTransaction = await tx.membershipUser.findUnique({
          where: { id },
          include: {
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!membershipTransaction) {
          throw new NotFoundException('Membership transaction not found')
        }

        // Check if already paid
        if (
          membershipTransaction.invoice &&
          membershipTransaction.invoice.status === PaymentStatus.PAID
        ) {
          throw new BadRequestException(
            'Membership transaction is already paid',
          )
        }

        // Update invoice status to PAID
        if (membershipTransaction.invoice) {
          await tx.invoice.update({
            where: { id: membershipTransaction.invoice.id },
            data: {
              status: PaymentStatus.PAID,
              paidAt: new Date(),
            },
          })

          // Update payment status to PAID
          if (membershipTransaction.invoice.payment) {
            await tx.payment.update({
              where: { id: membershipTransaction.invoice.payment.id },
              data: {
                status: PaymentStatus.PAID,
                paidAt: new Date(),
              },
            })
          }
        }

        return membershipTransaction
      })

      return c.json(
        ok(result, 'Membership transaction approved successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in approveMembershipTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/membership-transactions/:id/reject
// Reject membership transaction (cancel invoice/payment)
export const rejectMembershipTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const membershipTransaction = await tx.membershipUser.findUnique({
          where: { id },
          include: {
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!membershipTransaction) {
          throw new NotFoundException('Membership transaction not found')
        }

        // Check if already cancelled
        if (
          membershipTransaction.invoice &&
          membershipTransaction.invoice.status === PaymentStatus.CANCELLED
        ) {
          throw new BadRequestException(
            'Membership transaction is already cancelled',
          )
        }

        // Update invoice status to CANCELLED
        if (membershipTransaction.invoice) {
          await tx.invoice.update({
            where: { id: membershipTransaction.invoice.id },
            data: {
              status: PaymentStatus.CANCELLED,
              cancelledAt: new Date(),
            },
          })

          // Update payment status to CANCELLED
          if (membershipTransaction.invoice.payment) {
            await tx.payment.update({
              where: { id: membershipTransaction.invoice.payment.id },
              data: {
                status: PaymentStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            })
          }
        }

        return membershipTransaction
      })

      return c.json(
        ok(result, 'Membership transaction rejected successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in rejectMembershipTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/membership-transactions/:id/suspend
// Suspend membership transaction
export const suspendMembershipTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const body = await c.req.json().catch(() => ({}))
      const { reason, suspensionEndDate } = body as {
        reason?: string
        suspensionEndDate?: string
      }

      const membershipTransaction = await db.membershipUser.findUnique({
        where: { id },
      })

      if (!membershipTransaction) {
        throw new NotFoundException('Membership transaction not found')
      }

      if (membershipTransaction.isSuspended) {
        throw new BadRequestException('Membership is already suspended')
      }

      const updated = await db.membershipUser.update({
        where: { id },
        data: {
          isSuspended: true,
          suspensionReason: reason || 'Suspended by admin',
          suspensionEndDate: suspensionEndDate
            ? new Date(suspensionEndDate)
            : undefined,
        },
      })

      return c.json(
        ok(updated, 'Membership transaction suspended successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in suspendMembershipTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/membership-transactions/:id/unsuspend
// Unsuspend membership transaction
export const unsuspendMembershipTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const membershipTransaction = await db.membershipUser.findUnique({
        where: { id },
      })

      if (!membershipTransaction) {
        throw new NotFoundException('Membership transaction not found')
      }

      if (!membershipTransaction.isSuspended) {
        throw new BadRequestException('Membership is not suspended')
      }

      const updated = await db.membershipUser.update({
        where: { id },
        data: {
          isSuspended: false,
          suspensionReason: null,
          suspensionEndDate: null,
        },
      })

      return c.json(
        ok(updated, 'Membership transaction unsuspended successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in unsuspendMembershipTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// GET /admin/membership-transactions/export/excel
// Export membership transactions to Excel
export const exportMembershipTransactionsToExcelHandler =
  factory.createHandlers(
    zValidator('query', membershipTransactionsQuerySchema, validateHook),
    async (c) => {
      try {
        const query = c.req.valid('query') as SearchQuerySchema & {
          sport?: CourtSport
        }
        const queryOptions = buildFindManyOptions(query, {
          defaultOrderBy: { createdAt: 'desc' },
          searchableFields: [],
        })
        let where = queryOptions.where || {}
        if (query.sport) {
          where = {
            ...where,
            membership: {
              sport: query.sport,
            },
          }
        }

        const membershipTransactions = await db.membershipUser.findMany({
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
            membership: {
              select: {
                id: true,
                name: true,
                description: true,
                sport: true,
                price: true,
                sessions: true,
                duration: true,
                benefits: {
                  select: {
                    id: true,
                    benefit: true,
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

        // Transform membership transactions data to Excel format
        const excelData = membershipTransactions.map((transaction) => {
          // Get benefits
          const benefits =
            transaction.membership.benefits?.map((b) => b.benefit).join(', ') ||
            'N/A'

          return {
            'Transaction ID': transaction.id,
            'Invoice Number': transaction.invoice?.number || 'N/A',
            'Customer Name': transaction.user.name,
            'Customer Email': transaction.user.email || 'N/A',
            'Customer Phone': transaction.user.phone,
            'Membership Name': transaction.membership.name,
            'Membership Sport': transaction.membership.sport,
            'Membership Description':
              transaction.membership.description || 'N/A',
            'Membership Price': transaction.membership.price,
            'Total Sessions': transaction.membership.sessions,
            'Duration (Days)': transaction.membership.duration,
            Benefits: benefits,
            'Start Date': dayjs(transaction.startDate).format('YYYY-MM-DD'),
            'End Date': dayjs(transaction.endDate).format('YYYY-MM-DD'),
            'Remaining Sessions': transaction.remainingSessions,
            'Remaining Duration': transaction.remainingDuration,
            'Is Expired': transaction.isExpired ? 'Yes' : 'No',
            'Is Suspended': transaction.isSuspended ? 'Yes' : 'No',
            'Suspension Reason': transaction.suspensionReason || 'N/A',
            'Suspension End Date': transaction.suspensionEndDate
              ? dayjs(transaction.suspensionEndDate).format('YYYY-MM-DD')
              : 'N/A',
            'Payment Status': transaction.invoice?.status || 'N/A',
            'Payment Method':
              transaction.invoice?.payment?.method.name || 'N/A',
            'Total Paid':
              transaction.invoice?.total || transaction.membership.price,
            'Created At': dayjs(transaction.createdAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ),
          }
        })

        // Create workbook and worksheet
        const worksheet = XLSX.utils.json_to_sheet(excelData)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(
          workbook,
          worksheet,
          'Membership Transactions',
        )

        // Set column widths for better readability
        const columnWidths = [
          { wch: 30 }, // Transaction ID
          { wch: 25 }, // Invoice Number
          { wch: 25 }, // Customer Name
          { wch: 30 }, // Customer Email
          { wch: 20 }, // Customer Phone
          { wch: 25 }, // Membership Name
          { wch: 16 }, // Membership Sport
          { wch: 40 }, // Membership Description
          { wch: 15 }, // Membership Price
          { wch: 15 }, // Total Sessions
          { wch: 15 }, // Duration (Days)
          { wch: 40 }, // Benefits
          { wch: 15 }, // Start Date
          { wch: 15 }, // End Date
          { wch: 18 }, // Remaining Sessions
          { wch: 18 }, // Remaining Duration
          { wch: 12 }, // Is Expired
          { wch: 15 }, // Is Suspended
          { wch: 30 }, // Suspension Reason
          { wch: 20 }, // Suspension End Date
          { wch: 15 }, // Payment Status
          { wch: 20 }, // Payment Method
          { wch: 15 }, // Total Paid
          { wch: 20 }, // Created At
        ]
        worksheet['!cols'] = columnWidths

        // Generate Excel buffer
        const excelBuffer = XLSX.write(workbook, {
          type: 'buffer',
          bookType: 'xlsx',
        })

        // Generate filename with timestamp
        const filename = `membership-transactions-${dayjs().format('YYYY-MM-DD-HHmmss')}.xlsx`

        // Set headers for file download
        c.header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        c.header('Content-Disposition', `attachment; filename="${filename}"`)

        return c.body(excelBuffer)
      } catch (error) {
        c.var.logger.fatal(
          `Error in exportMembershipTransactionsToExcelHandler: ${error}`,
        )
        throw error
      }
    },
  )
