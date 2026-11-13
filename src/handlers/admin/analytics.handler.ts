import { createIncomeSourceWorkbook } from '@/services/income-source-export'
import clubTime from '@/lib/club-time'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { searchQuerySchema, SearchQuerySchema } from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, PaymentStatus } from '@prisma/client'
import status from 'http-status'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import { z } from 'zod'
import {
  getIncomeBySourceAnalytics,
  getPaymentMethodAnalytics,
  exportDataToExcel,
  getBusinessAnalytics,
} from '@/services/analytics.service'

// GET /admin/analytics
// Get analytics overview with total transactions, revenue, and monthly trends
export const getAnalyticsHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema

      // Get date range from query (optional)
      const startDate = query.search
        ? dayjs(query.search).startOf('day').toDate()
        : dayjs().subtract(12, 'months').startOf('day').toDate()
      const endDate = dayjs().endOf('day').toDate()

      // Get all paid invoices
      const paidInvoices = await db.invoice.findMany({
        where: {
          status: PaymentStatus.PAID,
          NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
          paidAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          booking: true,
          classBooking: true,
          membershipUser: true,
        },
      })

      // Calculate total revenue
      const totalRevenue = paidInvoices.reduce(
        (sum, invoice) => sum + invoice.total,
        0,
      )

      // Count transactions by type
      const totalBookings = await db.booking.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const totalClassBookings = await db.classBooking.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const totalMembershipTransactions = await db.membershipUser.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      // Count confirmed/paid transactions
      const confirmedBookings = await db.booking.count({
        where: {
          status: BookingStatus.CONFIRMED,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const confirmedClassBookings = await db.classBooking.count({
        where: {
          status: BookingStatus.CONFIRMED,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      // Calculate monthly trends
      const monthlyTrends: Record<string, any> = {}

      paidInvoices.forEach((invoice) => {
        if (invoice.paidAt) {
          const monthKey = dayjs(invoice.paidAt).format('YYYY-MM')
          if (!monthlyTrends[monthKey]) {
            monthlyTrends[monthKey] = {
              month: monthKey,
              revenue: 0,
              bookingCount: 0,
              classBookingCount: 0,
              membershipCount: 0,
              totalTransactions: 0,
            }
          }
          monthlyTrends[monthKey].revenue += invoice.total
          monthlyTrends[monthKey].totalTransactions += 1

          if (invoice.bookingId) {
            monthlyTrends[monthKey].bookingCount += 1
          } else if (invoice.classBookingId) {
            monthlyTrends[monthKey].classBookingCount += 1
          } else if (invoice.membershipUserId) {
            monthlyTrends[monthKey].membershipCount += 1
          }
        }
      })

      // Convert to array and sort by month
      const monthlyTrendsArray = Object.values(monthlyTrends).sort(
        (a: any, b: any) => a.month.localeCompare(b.month),
      )

      // Calculate revenue by type
      const revenueByType = {
        bookings: paidInvoices
          .filter((inv) => inv.bookingId)
          .reduce((sum, inv) => sum + inv.total, 0),
        classBookings: paidInvoices
          .filter((inv) => inv.classBookingId)
          .reduce((sum, inv) => sum + inv.total, 0),
        memberships: paidInvoices
          .filter((inv) => inv.membershipUserId)
          .reduce((sum, inv) => sum + inv.total, 0),
      }

      // Calculate average transaction value
      const averageTransactionValue =
        paidInvoices.length > 0
          ? Math.round(totalRevenue / paidInvoices.length)
          : 0

      const analytics = {
        overview: {
          totalRevenue,
          totalTransactions:
            totalBookings + totalClassBookings + totalMembershipTransactions,
          totalBookings,
          totalClassBookings,
          totalMembershipTransactions,
          confirmedBookings,
          confirmedClassBookings,
          averageTransactionValue,
          paidInvoicesCount: paidInvoices.length,
        },
        revenueByType,
        monthlyTrends: monthlyTrendsArray,
        dateRange: {
          startDate: dayjs(startDate).format('YYYY-MM-DD'),
          endDate: dayjs(endDate).format('YYYY-MM-DD'),
        },
      }

      return c.json(ok(analytics), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAnalyticsHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/analytics/export/excel
// Export analytics to Excel
export const exportAnalyticsToExcelHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema

      // Get date range from query (optional)
      const startDate = query.search
        ? dayjs(query.search).startOf('day').toDate()
        : dayjs().subtract(12, 'months').startOf('day').toDate()
      const endDate = dayjs().endOf('day').toDate()

      // Get all paid invoices
      const paidInvoices = await db.invoice.findMany({
        where: {
          status: PaymentStatus.PAID,
          NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
          paidAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          booking: {
            include: {
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
          classBooking: {
            include: {
              user: {
                select: {
                  name: true,
                },
              },
              class: {
                select: {
                  name: true,
                },
              },
            },
          },
          membershipUser: {
            include: {
              user: {
                select: {
                  name: true,
                },
              },
              membership: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      })

      // Calculate overview
      const totalRevenue = paidInvoices.reduce(
        (sum, invoice) => sum + invoice.total,
        0,
      )

      const totalBookings = await db.booking.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const totalClassBookings = await db.classBooking.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const totalMembershipTransactions = await db.membershipUser.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      // Calculate monthly trends
      const monthlyTrends: Record<string, any> = {}

      paidInvoices.forEach((invoice) => {
        if (invoice.paidAt) {
          const monthKey = dayjs(invoice.paidAt).format('YYYY-MM')
          if (!monthlyTrends[monthKey]) {
            monthlyTrends[monthKey] = {
              month: monthKey,
              revenue: 0,
              bookingCount: 0,
              classBookingCount: 0,
              membershipCount: 0,
              totalTransactions: 0,
            }
          }
          monthlyTrends[monthKey].revenue += invoice.total
          monthlyTrends[monthKey].totalTransactions += 1

          if (invoice.bookingId) {
            monthlyTrends[monthKey].bookingCount += 1
          } else if (invoice.classBookingId) {
            monthlyTrends[monthKey].classBookingCount += 1
          } else if (invoice.membershipUserId) {
            monthlyTrends[monthKey].membershipCount += 1
          }
        }
      })

      // Create workbook
      const workbook = XLSX.utils.book_new()

      // Sheet 1: Overview
      const overviewData = [
        { Metric: 'Total Revenue', Value: totalRevenue },
        {
          Metric: 'Total Transactions',
          Value:
            totalBookings + totalClassBookings + totalMembershipTransactions,
        },
        { Metric: 'Total Bookings', Value: totalBookings },
        { Metric: 'Total Class Bookings', Value: totalClassBookings },
        {
          Metric: 'Total Membership Transactions',
          Value: totalMembershipTransactions,
        },
        { Metric: 'Paid Invoices', Value: paidInvoices.length },
        {
          Metric: 'Average Transaction Value',
          Value:
            paidInvoices.length > 0
              ? Math.round(totalRevenue / paidInvoices.length)
              : 0,
        },
        {
          Metric: 'Date Range',
          Value: `${dayjs(startDate).format('YYYY-MM-DD')} to ${dayjs(endDate).format('YYYY-MM-DD')}`,
        },
      ]

      const overviewSheet = XLSX.utils.json_to_sheet(overviewData)
      overviewSheet['!cols'] = [{ wch: 30 }, { wch: 20 }]
      XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Overview')

      // Sheet 2: Monthly Trends
      const monthlyTrendsArray = Object.values(monthlyTrends)
        .sort((a: any, b: any) => a.month.localeCompare(b.month))
        .map((trend: any) => ({
          Month: trend.month,
          Revenue: trend.revenue,
          'Booking Count': trend.bookingCount,
          'Class Booking Count': trend.classBookingCount,
          'Membership Count': trend.membershipCount,
          'Total Transactions': trend.totalTransactions,
        }))

      const trendsSheet = XLSX.utils.json_to_sheet(monthlyTrendsArray)
      trendsSheet['!cols'] = [
        { wch: 15 }, // Month
        { wch: 15 }, // Revenue
        { wch: 15 }, // Booking Count
        { wch: 20 }, // Class Booking Count
        { wch: 18 }, // Membership Count
        { wch: 20 }, // Total Transactions
      ]
      XLSX.utils.book_append_sheet(workbook, trendsSheet, 'Monthly Trends')

      // Sheet 3: Transaction Details
      const transactionDetails = paidInvoices.map((invoice) => {
        let transactionType = 'N/A'
        let customerName = 'N/A'
        let itemName = 'N/A'

        if (invoice.bookingId && invoice.booking) {
          transactionType = 'Booking'
          customerName = invoice.booking.user?.name || 'N/A'
        } else if (invoice.classBookingId && invoice.classBooking) {
          transactionType = 'Class Booking'
          customerName = invoice.classBooking.user?.name || 'N/A'
          itemName = invoice.classBooking.class?.name || 'N/A'
        } else if (invoice.membershipUserId && invoice.membershipUser) {
          transactionType = 'Membership'
          customerName = invoice.membershipUser.user?.name || 'N/A'
          itemName = invoice.membershipUser.membership?.name || 'N/A'
        }

        return {
          'Invoice Number': invoice.number,
          'Transaction Type': transactionType,
          'Customer Name': customerName,
          'Item Name': itemName,
          Subtotal: invoice.subtotal,
          'Processing Fee': invoice.processingFee,
          Total: invoice.total,
          Status: invoice.status,
          'Issued At': invoice.issuedAt
            ? dayjs(invoice.issuedAt).format('YYYY-MM-DD HH:mm:ss')
            : 'N/A',
          'Paid At': invoice.paidAt
            ? dayjs(invoice.paidAt).format('YYYY-MM-DD HH:mm:ss')
            : 'N/A',
        }
      })

      const detailsSheet = XLSX.utils.json_to_sheet(transactionDetails)
      detailsSheet['!cols'] = [
        { wch: 25 }, // Invoice Number
        { wch: 18 }, // Transaction Type
        { wch: 25 }, // Customer Name
        { wch: 30 }, // Item Name
        { wch: 15 }, // Subtotal
        { wch: 15 }, // Processing Fee
        { wch: 15 }, // Total
        { wch: 15 }, // Status
        { wch: 20 }, // Issued At
        { wch: 20 }, // Paid At
      ]
      XLSX.utils.book_append_sheet(
        workbook,
        detailsSheet,
        'Transaction Details',
      )

      // Generate Excel buffer
      const excelBuffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      })

      // Generate filename with timestamp
      const filename = `analytics-${dayjs().format('YYYY-MM-DD-HHmmss')}.xlsx`

      // Set headers for file download
      c.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      c.header('Content-Disposition', `attachment; filename="${filename}"`)

      return c.body(excelBuffer)
    } catch (error) {
      c.var.logger.fatal(`Error in exportAnalyticsToExcelHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/analytics/dashboard
// Get dashboard statistics overview with accurate calculations
export const getDashboardStatsHandler = factory.createHandlers(async (c) => {
  try {
    // Define time periods for comparison
    const now = dayjs()
    const currentPeriodStart = now.startOf('month').toDate()
    const currentPeriodEnd = now.endOf('day').toDate()

    const previousPeriodStart = now
      .subtract(1, 'month')
      .startOf('month')
      .toDate()
    const previousPeriodEnd = now.subtract(1, 'month').endOf('month').toDate()

    const last6MonthsStart = now.subtract(6, 'months').startOf('month').toDate()

    // ============================================
    // 1. TOTAL REVENUE - Current period (this month)
    // ============================================
    const currentRevenue = await db.invoice.aggregate({
      where: {
        status: PaymentStatus.PAID,
        NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
        paidAt: {
          gte: currentPeriodStart,
          lte: currentPeriodEnd,
        },
      },
      _sum: {
        total: true,
      },
    })

    const previousRevenue = await db.invoice.aggregate({
      where: {
        status: PaymentStatus.PAID,
        NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
        paidAt: {
          gte: previousPeriodStart,
          lte: previousPeriodEnd,
        },
      },
      _sum: {
        total: true,
      },
    })

    const currentRevenueValue = currentRevenue._sum.total || 0
    const previousRevenueValue = previousRevenue._sum.total || 0

    const revenuePercentageChange =
      previousRevenueValue > 0
        ? Number(
            (
              ((currentRevenueValue - previousRevenueValue) /
                previousRevenueValue) *
              100
            ).toFixed(1),
          )
        : currentRevenueValue > 0
          ? 100
          : 0

    // ============================================
    // 2. TOTAL SALES - All confirmed transactions this month
    // ============================================
    const currentSales = await db.invoice.count({
      where: {
        status: PaymentStatus.PAID,
        NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
        paidAt: {
          gte: currentPeriodStart,
          lte: currentPeriodEnd,
        },
      },
    })

    const previousSales = await db.invoice.count({
      where: {
        status: PaymentStatus.PAID,
        NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
        paidAt: {
          gte: previousPeriodStart,
          lte: previousPeriodEnd,
        },
      },
    })

    const salesPercentageChange =
      previousSales > 0
        ? Number(
            (((currentSales - previousSales) / previousSales) * 100).toFixed(1),
          )
        : currentSales > 0
          ? 100
          : 0

    // ============================================
    // 3. NEW CUSTOMERS - Users created this month
    // ============================================
    const currentNewCustomers = await db.user.count({
      where: {
        createdAt: {
          gte: currentPeriodStart,
          lte: currentPeriodEnd,
        },
      },
    })

    const previousNewCustomers = await db.user.count({
      where: {
        createdAt: {
          gte: previousPeriodStart,
          lte: previousPeriodEnd,
        },
      },
    })

    const newCustomersPercentageChange =
      previousNewCustomers > 0
        ? Number(
            (
              ((currentNewCustomers - previousNewCustomers) /
                previousNewCustomers) *
              100
            ).toFixed(1),
          )
        : currentNewCustomers > 0
          ? 100
          : 0

    // ============================================
    // 4. ACTIVE ACCOUNTS - Users with transactions this month
    // ============================================
    // Get unique user IDs from all paid invoices this month
    const currentActiveInvoices = await db.invoice.findMany({
      where: {
        status: PaymentStatus.PAID,
        NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
        paidAt: {
          gte: currentPeriodStart,
          lte: currentPeriodEnd,
        },
      },
      select: {
        userId: true,
      },
    })

    const previousActiveInvoices = await db.invoice.findMany({
      where: {
        status: PaymentStatus.PAID,
        NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
        paidAt: {
          gte: previousPeriodStart,
          lte: previousPeriodEnd,
        },
      },
      select: {
        userId: true,
      },
    })

    const currentActiveAccounts = new Set(
      currentActiveInvoices.map((inv) => inv.userId).filter(Boolean),
    ).size

    const previousActiveAccounts = new Set(
      previousActiveInvoices.map((inv) => inv.userId).filter(Boolean),
    ).size

    const activeAccountsPercentageChange =
      previousActiveAccounts > 0
        ? Number(
            (
              ((currentActiveAccounts - previousActiveAccounts) /
                previousActiveAccounts) *
              100
            ).toFixed(1),
          )
        : currentActiveAccounts > 0
          ? 100
          : 0

    // ============================================
    // REVENUE TREND for last 6 months
    // ============================================
    const revenueByMonth = await db.invoice.groupBy({
      by: ['paidAt'],
      where: {
        status: PaymentStatus.PAID,
        NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
        paidAt: {
          gte: last6MonthsStart,
          lte: currentPeriodEnd,
        },
      },
      _sum: {
        total: true,
      },
    })

    // Process monthly data
    const monthlyRevenue: { [key: string]: number } = {}
    revenueByMonth.forEach((record) => {
      if (record.paidAt) {
        const monthKey = dayjs(record.paidAt).format('YYYY-MM')
        monthlyRevenue[monthKey] =
          (monthlyRevenue[monthKey] || 0) + (record._sum.total || 0)
      }
    })

    // Build array of last 6 months
    const last6Months: Array<{ month: string; revenue: number }> = []
    for (let i = 5; i >= 0; i--) {
      const month = now.subtract(i, 'months').format('YYYY-MM')
      last6Months.push({
        month,
        revenue: monthlyRevenue[month] || 0,
      })
    }

    // Determine trend based on recent months
    const recentMonths = last6Months.slice(-3).map((m) => m.revenue)
    const isUpTrend =
      recentMonths.length >= 2 &&
      recentMonths[recentMonths.length - 1] >=
        recentMonths[recentMonths.length - 2]

    // ============================================
    // Build response
    // ============================================
    const dashboardStats = {
      totalRevenue: {
        value: currentRevenueValue,
        formatted: `Rp ${currentRevenueValue.toLocaleString('id-ID')}`,
        percentageChange: revenuePercentageChange,
        trend:
          revenuePercentageChange > 0
            ? 'up'
            : revenuePercentageChange < 0
              ? 'down'
              : 'stable',
        description: 'Trending up this month',
        subtitle: 'Visitors for the last 6 months',
      },
      totalSales: {
        value: currentSales,
        percentageChange: salesPercentageChange,
        trend:
          salesPercentageChange > 0
            ? 'up'
            : salesPercentageChange < 0
              ? 'down'
              : 'stable',
        description: 'Steady performance increase',
        subtitle: 'Meets growth projections',
      },
      newCustomers: {
        value: currentNewCustomers,
        percentageChange: newCustomersPercentageChange,
        trend:
          newCustomersPercentageChange > 0
            ? 'up'
            : newCustomersPercentageChange < 0
              ? 'down'
              : 'stable',
        description:
          newCustomersPercentageChange < 0
            ? `Down ${Math.abs(newCustomersPercentageChange)}% this period`
            : 'Growing this period',
        subtitle:
          newCustomersPercentageChange < -10
            ? 'Acquisition needs attention'
            : 'Acquisition on track',
      },
      activeAccounts: {
        value: currentActiveAccounts,
        percentageChange: activeAccountsPercentageChange,
        trend:
          activeAccountsPercentageChange > 0
            ? 'up'
            : activeAccountsPercentageChange < 0
              ? 'down'
              : 'stable',
        description: 'Strong user retention',
        subtitle: 'Engagement exceed targets',
      },
      period: {
        current: {
          start: dayjs(currentPeriodStart).format('YYYY-MM-DD'),
          end: dayjs(currentPeriodEnd).format('YYYY-MM-DD'),
        },
        previous: {
          start: dayjs(previousPeriodStart).format('YYYY-MM-DD'),
          end: dayjs(previousPeriodEnd).format('YYYY-MM-DD'),
        },
      },
      revenueHistory: {
        last6Months,
        trend: isUpTrend ? 'up' : 'down',
      },
    }

    return c.json(ok(dashboardStats), status.OK)
  } catch (error) {
    c.var.logger.fatal(`Error in getDashboardStatsHandler: ${error}`)
    throw error
  }
})

// Schema for daily transactions query
const dailyTransactionsQuerySchema = z.object({
  period: z
    .enum(['7days', '30days', '3months'])
    .optional()
    .default('30days')
    .describe('Time period for the chart data'),
})

type DailyTransactionsQuery = z.infer<typeof dailyTransactionsQuerySchema>

// GET /admin/analytics/daily-transactions
// Get daily transaction counts for chart visualization with time period filters
export const getDailyTransactionsHandler = factory.createHandlers(
  zValidator('query', dailyTransactionsQuerySchema, validateHook),
  async (c) => {
    try {
      const { period } = c.req.valid('query') as DailyTransactionsQuery

      // Calculate date range based on period
      const now = dayjs()
      let startDate: Date
      let daysToShow: number

      switch (period) {
        case '7days':
          startDate = now.subtract(7, 'days').startOf('day').toDate()
          daysToShow = 7
          break
        case '30days':
          startDate = now.subtract(30, 'days').startOf('day').toDate()
          daysToShow = 30
          break
        case '3months':
          startDate = now.subtract(3, 'months').startOf('day').toDate()
          daysToShow = 90
          break
        default:
          startDate = now.subtract(30, 'days').startOf('day').toDate()
          daysToShow = 30
      }

      const endDate = now.endOf('day').toDate()

      // Fetch all paid invoices in the date range
      const invoices = await db.invoice.findMany({
        where: {
          status: PaymentStatus.PAID,
          NOT: { inHouseWallet: { is: { deletedAt: { not: null } } } },
          paidAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          id: true,
          total: true,
          paidAt: true,
        },
        orderBy: {
          paidAt: 'asc',
        },
      })

      // Group transactions by date
      const transactionsByDate: { [key: string]: number } = {}

      invoices.forEach((invoice) => {
        if (invoice.paidAt) {
          const dateKey = dayjs(invoice.paidAt).format('YYYY-MM-DD')
          transactionsByDate[dateKey] = (transactionsByDate[dateKey] || 0) + 1
        }
      })

      // Build complete array with all dates (including zero-transaction days)
      const chartData: Array<{ date: string; total: number }> = []

      for (let i = daysToShow - 1; i >= 0; i--) {
        const date = now.subtract(i, 'days').format('YYYY-MM-DD')
        chartData.push({
          date,
          total: transactionsByDate[date] || 0,
        })
      }

      // Calculate summary statistics
      const totalTransactions = invoices.length
      const totalRevenue = invoices.reduce((sum, inv) => sum + inv.total, 0)
      const averagePerDay =
        chartData.length > 0
          ? Number((totalTransactions / chartData.length).toFixed(2))
          : 0
      const daysWithTransactions = Object.keys(transactionsByDate).length

      const response = {
        chartData,
        summary: {
          period,
          totalTransactions,
          totalRevenue,
          averagePerDay,
          daysWithTransactions,
          dateRange: {
            start: dayjs(startDate).format('YYYY-MM-DD'),
            end: dayjs(endDate).format('YYYY-MM-DD'),
          },
        },
      }

      return c.json(ok(response), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getDailyTransactionsHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/analytics/income-by-source
// Get income analytics separated by source (online vs cashier, booking vs class vs membership)
const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  source: z.enum(['cashier', 'online']).optional(),
})

const incomeSourceDates = (query: z.infer<typeof dateRangeSchema>) => ({
  startDate: query.startDate
    ? new Date(query.startDate)
    : dayjs().subtract(1, 'month').startOf('day').toDate(),
  endDate: query.endDate
    ? new Date(query.endDate)
    : dayjs().endOf('day').toDate(),
})

export const exportIncomeBySourceHandler = factory.createHandlers(
  zValidator('query', dateRangeSchema, validateHook),
  async (c) => {
    const query = c.req.valid('query')
    const { startDate, endDate } = incomeSourceDates(query)
    const report = await getIncomeBySourceAnalytics(
      startDate,
      endDate,
      query.source,
    )
    const book = createIncomeSourceWorkbook(report)
    c.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    c.header(
      'Content-Disposition',
      `attachment; filename="income-by-source-${clubTime(startDate).format('YYYY-MM-DD')}-${clubTime(endDate).format('YYYY-MM-DD')}.xlsx"`,
    )
    return c.body(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  },
)

export const getIncomeBySourceHandler = factory.createHandlers(
  zValidator('query', dateRangeSchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query')

      const { startDate, endDate } = incomeSourceDates(query)

      const source = (query.source as 'cashier' | 'online') || undefined
      const data = await getIncomeBySourceAnalytics(startDate, endDate, source)

      return c.json(ok(data), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getIncomeBySourceHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/analytics/payment-methods
// Get payment method analytics showing which payment methods drive revenue
export const getPaymentMethodsHandler = factory.createHandlers(
  zValidator('query', dateRangeSchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query')

      const startDate = query.startDate
        ? new Date(query.startDate)
        : dayjs().subtract(1, 'month').startOf('day').toDate()
      const endDate = query.endDate
        ? new Date(query.endDate)
        : dayjs().endOf('day').toDate()

      const source = (query.source as 'cashier' | 'online') || undefined
      const data = await getPaymentMethodAnalytics(startDate, endDate, source)

      return c.json(ok(data), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getPaymentMethodsHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/analytics/business-insights
// Get comprehensive business analytics across all entities
export const getBusinessInsightsHandler = factory.createHandlers(
  zValidator('query', dateRangeSchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query')

      const startDate = query.startDate
        ? new Date(query.startDate)
        : dayjs().subtract(1, 'month').startOf('day').toDate()
      const endDate = query.endDate
        ? new Date(query.endDate)
        : dayjs().endOf('day').toDate()

      const data = await getBusinessAnalytics(startDate, endDate)

      return c.json(ok(data), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getBusinessInsightsHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/analytics/export/bulk-data
// Export courts, inventory, and coach booking data to Excel
const exportQuerySchema = z.object({
  type: z.enum(['courts', 'inventory', 'coach-bookings', 'bookings']),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
})

export const exportBulkDataHandler = factory.createHandlers(
  zValidator('query', exportQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query')

      const startDate = query.startDate ? new Date(query.startDate) : undefined
      const endDate = query.endDate ? new Date(query.endDate) : undefined

      const buffer = await exportDataToExcel(query.type, startDate, endDate)

      const filename = `${query.type}-export-${dayjs().format('YYYY-MM-DD')}.xlsx`

      c.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      c.header('Content-Disposition', `attachment; filename="${filename}"`)

      return c.body(buffer as any)
    } catch (error) {
      c.var.logger.fatal(`Error in exportBulkDataHandler: ${error}`)
      throw error
    }
  },
)
