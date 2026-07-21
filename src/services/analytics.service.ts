import { db } from '@/lib/prisma'
import { BookingStatus, CourtSport, PaymentStatus } from '@prisma/client'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { getFileUrl } from './upload.service'

/**
 * Get income analytics separated by source
 * Sources: Online bookings, Cashier bookings, Class bookings, Memberships
 */
export async function getIncomeBySourceAnalytics(
  startDate: Date,
  endDate: Date,
  source?: 'cashier' | 'online',
) {
  // Build where clause with optional source filter
  const invoiceWhere: any = {
    status: PaymentStatus.PAID,
    paidAt: { gte: startDate, lte: endDate },
  }

  const includeClause: any = {
    booking: {
      include: { cashier: { select: { id: true, name: true, email: true } } },
    },
    classBooking: true,
    membershipUser: true,
  }

  if (source === 'cashier') {
    // invoices where booking exists and was paid via cashier (cashierId not null)
    invoiceWhere.booking = { isNot: null, cashierId: { not: null } }
  } else if (source === 'online') {
    // invoices where booking exists and cashierId is null (online)
    invoiceWhere.booking = { isNot: null, cashierId: null }
  }

  const invoices = await db.invoice.findMany({
    where: invoiceWhere,
    include: includeClause,
  })

  // Separate by source and account for processing fees
  let onlineBookingIncome = 0
  let cashierBookingIncome = 0
  let classBookingIncome = 0
  let membershipIncome = 0
  let totalProcessingFees = 0
  let totalGrossAmount = 0
  let totalNetAmount = 0

  const bookingIncome: Record<string, any> = {}
  const classIncome: Record<string, any> = {}
  const membershipIncome_: Record<string, any> = {}

  for (const invoice of invoices as any[]) {
    const gross = invoice.total || 0
    const processingFee = invoice.processingFee || 0
    const netAmount = gross - processingFee
    // Accumulate overall totals once per invoice
    totalGrossAmount += gross
    totalProcessingFees += processingFee
    totalNetAmount += netAmount

    // Court booking income
    if (invoice.booking) {
      const src = invoice.booking.cashier ? 'Cashier' : 'Online'
      // processingFee and netAmount already computed above

      if (src === 'Cashier') {
        cashierBookingIncome += netAmount
      } else {
        onlineBookingIncome += netAmount
      }

      if (!bookingIncome[src]) {
        bookingIncome[src] = {
          count: 0,
          total: 0,
          processingFee: 0,
          transactions: [],
        }
      }
      bookingIncome[src].count += 1
      bookingIncome[src].total += netAmount
      bookingIncome[src].processingFee += processingFee
      bookingIncome[src].transactions.push({
        id: invoice.id,
        bookingId: invoice.booking.id,
        amount: invoice.total,
        processingFee,
        netAmount,
        date: invoice.paidAt,
      })
    }

    // Class booking income
    if (invoice.classBooking) {
      const processingFee = invoice.processingFee || 0
      const netAmount = (invoice.total || 0) - processingFee
      classBookingIncome += netAmount
      if (!classIncome['Class Bookings']) {
        classIncome['Class Bookings'] = {
          count: 0,
          total: 0,
          processingFee: 0,
          transactions: [],
        }
      }
      classIncome['Class Bookings'].count += 1
      classIncome['Class Bookings'].total += netAmount
      classIncome['Class Bookings'].processingFee += processingFee
      classIncome['Class Bookings'].transactions.push({
        id: invoice.id,
        classBookingId: invoice.classBooking.id,
        amount: invoice.total,
        processingFee,
        netAmount,
        date: invoice.paidAt,
      })
    }

    // Membership income
    if (invoice.membershipUser) {
      const processingFee = invoice.processingFee || 0
      const netAmount = (invoice.total || 0) - processingFee
      membershipIncome += netAmount
      if (!membershipIncome_['Membership']) {
        membershipIncome_['Membership'] = {
          count: 0,
          total: 0,
          processingFee: 0,
          transactions: [],
        }
      }
      membershipIncome_['Membership'].count += 1
      membershipIncome_['Membership'].total += netAmount
      membershipIncome_['Membership'].processingFee += processingFee
      membershipIncome_['Membership'].transactions.push({
        id: invoice.id,
        membershipUserId: invoice.membershipUser.id,
        amount: invoice.total,
        processingFee,
        netAmount,
        date: invoice.paidAt,
      })
    }
  }

  const totalIncome =
    onlineBookingIncome +
    cashierBookingIncome +
    classBookingIncome +
    membershipIncome

  return {
    summary: {
      totalIncome,
      totalGrossAmount,
      totalProcessingFees,
      totalNetAmount,
      onlineBookingIncome,
      cashierBookingIncome,
      classBookingIncome,
      membershipIncome,
      totalTransactions: invoices.length,
    },
    bySource: {
      ...bookingIncome,
      ...classIncome,
      ...membershipIncome_,
    },
    dateRange: { startDate, endDate },
  }
}

/**
 * Get payment method analytics
 * Shows which payment methods are most used
 */
export async function getPaymentMethodAnalytics(
  startDate: Date,
  endDate: Date,
  source?: 'cashier' | 'online',
) {
  const paymentWhere: any = {
    status: PaymentStatus.PAID,
    createdAt: { gte: startDate, lte: endDate },
  }

  if (source === 'cashier') {
    paymentWhere.invoice = {
      isNot: null,
      booking: { cashierId: { not: null } },
    }
  } else if (source === 'online') {
    paymentWhere.invoice = { isNot: null, booking: { cashierId: null } }
  }

  const payments = await db.payment.findMany({
    where: paymentWhere,
    include: {
      method: { select: { id: true, name: true, logo: true } },
      invoice: { select: { total: true, processingFee: true } },
    },
  })

  const methodAnalytics: Map<string, any> = new Map()

  let totalAmount = 0
  let totalProcessingFees = 0

  for (const payment of payments) {
    const amt = payment.invoice?.total || 0
    const procFee = payment.invoice?.processingFee || 0
    totalAmount += amt
    totalProcessingFees += procFee

    const methodId = payment.method?.id || 'unknown'
    if (!methodAnalytics.has(methodId)) {
      methodAnalytics.set(methodId, {
        method: {
          id: payment.method?.id || null,
          name: payment.method?.name || 'Unknown',
          logo: payment.method?.logo
            ? await getFileUrl(payment.method.logo)
            : null,
        },
        count: 0,
        total: 0,
        processingFee: 0,
        percentage: 0,
        transactions: [],
      })
    }

    const methodData = methodAnalytics.get(methodId)!
    methodData.count += 1
    methodData.total += amt
    methodData.processingFee += procFee
    methodData.transactions.push({
      id: payment.id,
      amount: amt,
      processingFee: procFee,
      date: payment.createdAt,
    })
  }

  // Calculate percentages and convert to array sorted by total
  const methodsArray = Array.from(methodAnalytics.values())
    .map((method) => ({
      ...method,
      percentage: totalAmount > 0 ? (method.total / totalAmount) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)

  return {
    summary: {
      totalAmount,
      totalProcessingFees,
      totalTransactions: payments.length,
      methodCount: methodsArray.length,
    },
    methods: methodsArray,
    dateRange: { startDate, endDate },
  }
}

/**
 * Export data to Excel
 * Can export: Courts, Inventory, Coach Bookings
 */
export async function exportDataToExcel(
  dataType: 'courts' | 'inventory' | 'coach-bookings' | 'bookings',
  startDate?: Date,
  endDate?: Date,
  source?: 'cashier' | 'online',
  courtSport?: CourtSport,
  coach?: 'with' | 'without',
): Promise<Buffer> {
  const workbook = XLSX.utils.book_new()

  if (dataType === 'courts') {
    const courts = await db.court.findMany({
      include: {
        costSchedules: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    const courtData = courts.map((court) => ({
      'Court ID': court.id,
      'Court Name': court.name,
      Description: court.description || 'N/A',
      'Is Active': court.isActive ? 'Yes' : 'No',
      'Current Cost (IDR)': court.costSchedules[0]?.price || 'N/A',
      'Created At': dayjs(court.createdAt).format('YYYY-MM-DD HH:mm'),
    }))

    const ws = XLSX.utils.json_to_sheet(courtData)
    XLSX.utils.book_append_sheet(workbook, ws, 'Courts')
  } else if (dataType === 'inventory') {
    const inventory = await db.inventory.findMany()

    const inventoryData = inventory.map((item) => ({
      'Item ID': item.id,
      'Item Name': item.name,
      Description: item.description || 'N/A',
      'Stock Quantity': item.quantity,
      'Unit Price (IDR)': item.price,
      'Total Value (IDR)': item.quantity * item.price,
      'Is Active': item.isActive ? 'Yes' : 'No',
      'Created At': dayjs(item.createdAt).format('YYYY-MM-DD HH:mm'),
    }))

    const ws = XLSX.utils.json_to_sheet(inventoryData)
    XLSX.utils.book_append_sheet(workbook, ws, 'Inventory')
  } else if (dataType === 'coach-bookings') {
    const coachBookings = await db.bookingCoach.findMany({
      where:
        startDate && endDate
          ? { createdAt: { gte: startDate, lte: endDate } }
          : undefined,
      include: {
        booking: {
          select: {
            id: true,
            totalPrice: true,
            createdAt: true,
            user: { select: { name: true, email: true } },
          },
        },
        slot: {
          select: {
            id: true,
            startAt: true,
            endAt: true,
            staffId: true,
          },
        },
        bookingCoachType: { select: { name: true } },
      },
    })

    // Get staff details (coaches)
    const staffIds = coachBookings
      .map((cb) => cb.slot?.staffId)
      .filter(Boolean) as string[]

    const staffDetails = await db.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    })

    const staffMap = new Map(staffDetails.map((s) => [s.id, s.name]))

    const coachBookingData = coachBookings.map((cb) => ({
      'Booking ID': cb.booking?.id || 'N/A',
      Coach: cb.slot?.staffId ? staffMap.get(cb.slot.staffId) || 'N/A' : 'N/A',
      'Coach Type': cb.bookingCoachType?.name || 'N/A',
      'Customer Name': cb.booking?.user?.name || 'N/A',
      'Customer Email': cb.booking?.user?.email || 'N/A',
      Date: cb.slot?.startAt
        ? dayjs(cb.slot.startAt).format('YYYY-MM-DD')
        : 'N/A',
      'Start Time': cb.slot?.startAt
        ? dayjs(cb.slot.startAt).format('HH:mm')
        : 'N/A',
      'End Time': cb.slot?.endAt ? dayjs(cb.slot.endAt).format('HH:mm') : 'N/A',
      'Total Amount (IDR)': cb.price || 0,
      'Booking Date': cb.booking?.createdAt
        ? dayjs(cb.booking.createdAt).format('YYYY-MM-DD HH:mm')
        : 'N/A',
    }))

    const ws = XLSX.utils.json_to_sheet(coachBookingData)
    XLSX.utils.book_append_sheet(workbook, ws, 'Coach Bookings')
  } else if (dataType === 'bookings') {
    const where: any =
      startDate && endDate
        ? { createdAt: { gte: startDate, lte: endDate } }
        : {}
    if (source === 'cashier') {
      where.cashierId = { not: null }
    } else if (source === 'online') {
      where.cashierId = null
    }
    if (courtSport) {
      where.details = {
        some: {
          court: {
            sport: courtSport,
          },
        },
      }
    }
    if (coach === 'with') {
      where.coaches = { some: {} }
    } else if (coach === 'without') {
      where.coaches = { none: {} }
    }

    const bookings = await db.booking.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        cashier: { select: { id: true, name: true, email: true } },
        details: {
          include: {
            court: { select: { id: true, name: true, sport: true } },
            slot: { select: { startAt: true, endAt: true, price: true } },
          },
        },
        coaches: { select: { id: true } },
        ballboys: { select: { id: true } },
        inventories: {
          include: { inventory: { select: { id: true, name: true } } },
        },
        invoice: {
          select: {
            number: true,
            status: true,
            subtotal: true,
            processingFee: true,
            total: true,
            paidAt: true,
            payment: { select: { method: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const bookingsData = bookings.map((b) => {
      const courts = Array.from(
        new Set((b.details || []).map((d) => d.court?.name).filter(Boolean)),
      )
      const courtSports = Array.from(
        new Set((b.details || []).map((d) => d.court?.sport).filter(Boolean)),
      )
      const slots = (b.details || [])
        .map((d) =>
          d.slot?.startAt && d.slot?.endAt
            ? `${dayjs(d.slot.startAt).format('YYYY-MM-DD HH:mm')}-${dayjs(d.slot.endAt).format('HH:mm')}`
            : 'N/A',
        )
        .filter((s) => s !== 'N/A')
      const courtPriceSum = (b.details || []).reduce(
        (sum, d) => sum + (d.slot?.price || 0),
        0,
      )
      const inventoryItems = (b.inventories || [])
        .map((i) => i.inventory?.name)
        .filter(Boolean)
      const source = b.cashier ? 'Cashier' : 'Online'

      const netAmount =
        (b.invoice?.total || 0) - (b.invoice?.processingFee || 0)
      return {
        'Booking ID': b.id,
        'Customer ID': b.user?.id || 'N/A',
        Source: source,
        Status: b.status,
        'Customer Name': b.user?.name || 'N/A',
        'Customer Email': b.user?.email || 'N/A',
        'Customer Phone': b.user?.phone || 'N/A',
        'Cashier Name': b.cashier?.name || 'N/A',
        'Cashier ID': b.cashier?.id || 'N/A',
        'Created At': dayjs(b.createdAt).format('YYYY-MM-DD HH:mm'),
        'Invoice Number': b.invoice?.number || 'N/A',
        'Invoice Status': b.invoice?.status || 'N/A',
        'Subtotal (IDR)': b.invoice?.subtotal || 0,
        'Processing Fee (IDR)': b.invoice?.processingFee || 0,
        'Total Amount (IDR)': b.invoice?.total || 0,
        'Net Amount (IDR)': netAmount,
        'Paid At': b.invoice?.paidAt
          ? dayjs(b.invoice.paidAt).format('YYYY-MM-DD HH:mm')
          : 'N/A',
        'Payment Method': b.invoice?.payment?.method?.name || 'N/A',
        'Court Sport': courtSports.join('; '),
        Courts: courts.join('; '),
        Slots: slots.join('; '),
        'Court Price Sum (IDR)': courtPriceSum,
        'Coach Count': (b.coaches || []).length,
        'Ballboy Count': (b.ballboys || []).length,
        'Inventory Items': inventoryItems.join('; '),
      }
    })

    const ws = XLSX.utils.json_to_sheet(bookingsData)
    ws['!cols'] = [
      { wch: 24 }, // Booking ID
      { wch: 18 }, // Customer ID
      { wch: 10 }, // Source
      { wch: 12 }, // Status
      { wch: 20 }, // Customer Name
      { wch: 24 }, // Customer Email
      { wch: 18 }, // Customer Phone
      { wch: 20 }, // Cashier Name
      { wch: 18 }, // Cashier ID
      { wch: 20 }, // Created At
      { wch: 20 }, // Invoice Number
      { wch: 14 }, // Invoice Status
      { wch: 16 }, // Subtotal
      { wch: 18 }, // Processing Fee
      { wch: 18 }, // Total Amount
      { wch: 18 }, // Net Amount
      { wch: 20 }, // Paid At
      { wch: 16 }, // Payment Method
      { wch: 12 }, // Court Sport
      { wch: 24 }, // Courts
      { wch: 36 }, // Slots
      { wch: 18 }, // Court Price Sum
      { wch: 14 }, // Coach Count
      { wch: 14 }, // Ballboy Count
      { wch: 30 }, // Inventory Items
    ]
    XLSX.utils.book_append_sheet(workbook, ws, 'Bookings')
  }

  // Convert to buffer
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })
  return buffer as Buffer
}

/**
 * Get comprehensive business analytics
 * Includes: Courts, Coaches, Inventory, Memberships
 */
export async function getBusinessAnalytics(startDate: Date, endDate: Date) {
  // Court statistics
  const totalCourts = await db.court.count()
  const bookedCourts = await db.bookingDetail.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    distinct: ['courtId'],
    select: { courtId: true },
  })

  // Top hours and days analytics
  // Get all booking slots in the period
  const bookingSlots = await db.bookingDetail.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      slot: {
        select: {
          startAt: true,
        },
      },
    },
  })

  // Count frequency by hour and day
  const hourCounts: Record<string, number> = {}
  const dayCounts: Record<string, number> = {}
  for (const bd of bookingSlots) {
    const startAt = bd.slot?.startAt
    if (startAt) {
      const dateObj = new Date(startAt)
      const hour = dateObj.getHours().toString().padStart(2, '0') + ':00'
      const day = dateObj.toLocaleDateString('en-US', { weekday: 'long' })
      hourCounts[hour] = (hourCounts[hour] || 0) + 1
      dayCounts[day] = (dayCounts[day] || 0) + 1
    }
  }
  // Sort and get top 5 for each
  const topHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hour, count]) => ({ hour, count }))
  const topDays = Object.entries(dayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([day, count]) => ({ day, count }))

  // Coach statistics (Staff with coach role)
  const totalStaff = await db.staff.count()
  const activeCoaches = await db.bookingCoach.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    select: { slot: { select: { staffId: true } } },
  })

  const uniqueCoachIds = new Set(
    activeCoaches.map((bc) => bc.slot?.staffId).filter(Boolean),
  )

  const coachSessionCount = await db.bookingCoach.count({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  // Inventory statistics
  const totalInventoryItems = await db.inventory.count()
  const usedInventory = await db.bookingInventory.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    distinct: ['inventoryId'],
    select: { inventoryId: true },
  })

  const totalInventoryValue = await db.inventory.aggregate({
    _sum: { price: true },
  })

  // Membership statistics
  const totalMemberships = await db.membership.count()
  const activeMemberships = await db.membershipUser.count({
    where: {
      endDate: { gt: new Date() },
    },
  })

  const newMemberships = await db.membershipUser.count({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  // Booking statistics
  const totalBookings = await db.booking.count({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  const confirmedBookings = await db.booking.count({
    where: {
      status: BookingStatus.CONFIRMED,
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  // Revenue
  const invoiceData = await db.invoice.aggregate({
    where: {
      status: PaymentStatus.PAID,
      paidAt: { gte: startDate, lte: endDate },
    },
    _sum: { total: true },
    _count: true,
  })

  // Most booked courts
  const topCourts = await db.bookingDetail.groupBy({
    by: ['courtId'],
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  })

  const topCourtDetails = await Promise.all(
    topCourts.map(async (tc) => {
      const court = await db.court.findUnique({
        where: { id: tc.courtId || '' },
        select: { id: true, name: true },
      })
      return { court, bookings: tc._count.id }
    }),
  )

  const courtBookingDetails = await db.bookingDetail.findMany({
    where: {
      courtId: { not: null },
      booking: {
        status: { not: BookingStatus.CANCELLED },
      },
      slot: {
        startAt: { gte: startDate, lte: endDate },
      },
    },
    select: {
      courtId: true,
      slot: {
        select: {
          startAt: true,
          endAt: true,
        },
      },
    },
  })

  const courtHoursMap = new Map<
    string,
    { bookedHours: number; bookingCount: number }
  >()
  for (const detail of courtBookingDetails) {
    const courtId = detail.courtId!
    const start = detail.slot.startAt
    const end = detail.slot.endAt
    const durationHours = Math.max(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60),
      0,
    )
    const existing = courtHoursMap.get(courtId) || {
      bookedHours: 0,
      bookingCount: 0,
    }
    existing.bookedHours += durationHours
    existing.bookingCount += 1
    courtHoursMap.set(courtId, existing)
  }

  const allCourts = await db.court.findMany({
    select: { id: true, name: true, sport: true },
    orderBy: { name: 'asc' },
  })

  const courtHours = allCourts
    .map((court) => {
      const stats = courtHoursMap.get(court.id) || {
        bookedHours: 0,
        bookingCount: 0,
      }
      return {
        court,
        bookedHours: Math.round(stats.bookedHours * 10) / 10,
        bookingCount: stats.bookingCount,
      }
    })
    .sort((a, b) => b.bookedHours - a.bookedHours)

  const totalBookedHours = Math.round(
    courtHours.reduce((sum, item) => sum + item.bookedHours, 0) * 10,
  ) / 10

  // Top coaches
  const topCoachesData: Record<string, number> = {}
  for (const bc of activeCoaches) {
    const staffId = bc.slot?.staffId
    if (staffId) {
      topCoachesData[staffId] = (topCoachesData[staffId] || 0) + 1
    }
  }

  const topCoachIds = Object.entries(topCoachesData)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id)

  const topCoachStaff = await db.staff.findMany({
    where: { id: { in: topCoachIds } },
    select: { id: true, name: true },
  })

  const topCoachDetails = topCoachStaff.map((coach) => ({
    coach: { id: coach.id, name: coach.name },
    sessions: topCoachesData[coach.id] || 0,
  }))

  return {
    courts: {
      total: totalCourts,
      booked: bookedCourts.length,
      utilization:
        totalCourts > 0
          ? ((bookedCourts.length / totalCourts) * 100).toFixed(2) + '%'
          : '0%',
      totalBookedHours,
      topCourts: topCourtDetails,
      courtHours,
      topHours,
      topDays,
    },
    coaches: {
      total: totalStaff,
      active: uniqueCoachIds.size,
      totalSessions: coachSessionCount,
      topCoaches: topCoachDetails,
    },
    inventory: {
      totalItems: totalInventoryItems,
      itemsUsed: usedInventory.length,
      totalValue: totalInventoryValue._sum.price || 0,
      utilizationRate:
        totalInventoryItems > 0
          ? ((usedInventory.length / totalInventoryItems) * 100).toFixed(2) +
            '%'
          : '0%',
    },
    memberships: {
      total: totalMemberships,
      active: activeMemberships,
      newInPeriod: newMemberships,
      activePercentage:
        totalMemberships > 0
          ? ((activeMemberships / totalMemberships) * 100).toFixed(2) + '%'
          : '0%',
    },
    bookings: {
      total: totalBookings,
      confirmed: confirmedBookings,
      confirmationRate:
        totalBookings > 0
          ? ((confirmedBookings / totalBookings) * 100).toFixed(2) + '%'
          : '0%',
    },
    revenue: {
      total: invoiceData._sum.total || 0,
      transactions: invoiceData._count,
      avgPerTransaction:
        invoiceData._count > 0
          ? ((invoiceData._sum.total || 0) / invoiceData._count).toFixed(2)
          : '0',
    },
    dateRange: { startDate, endDate },
  }
}
