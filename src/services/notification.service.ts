import { branchContext } from '@/lib/branch-context'
import { db } from '@/lib/prisma'
import {
  NotificationAudience,
  NotificationType,
  PaymentStatus,
} from '@prisma/client'

export interface CreateNotificationInput {
  branchId?: string
  userId?: string
  audience?: NotificationAudience
  type: NotificationType
  title: string
  message?: string
  data?: Record<string, any>
}

export const notificationService = {
  async create(input: CreateNotificationInput) {
    const {
      userId,
      audience = NotificationAudience.USER,
      type,
      title,
      message,
      data,
    } = input
    let branchId =
      input.branchId ?? branchContext.getStore()?.branchId ?? undefined
    if (!branchId && typeof data?.invoiceId === 'string') {
      branchId = (
        await db.invoice.findUnique({
          where: { id: data.invoiceId },
          select: { branchId: true },
        })
      )?.branchId
    }
    if (!branchId && typeof data?.bookingId === 'string') {
      branchId = (
        await db.booking.findUnique({
          where: { id: data.bookingId },
          select: { branchId: true },
        })
      )?.branchId
    }
    if (!branchId && typeof data?.membershipUserId === 'string') {
      branchId = (
        await db.invoice.findUnique({
          where: { membershipUserId: data.membershipUserId },
          select: { branchId: true },
        })
      )?.branchId
    }
    return db.notification.create({
      data: {
        branchId,
        userId: userId || null,
        audience,
        type,
        title,
        message,
        data: data ? (data as any) : undefined,
      },
    })
  },

  async listForUser(userId: string, take = 50, cursor?: string) {
    return db.notification.findMany({
      where: {
        OR: [
          { audience: NotificationAudience.ALL },
          { audience: NotificationAudience.USER, userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  },

  async listForAdmin(take = 50, cursor?: string) {
    return db.notification.findMany({
      where: {
        OR: [
          { audience: NotificationAudience.ADMIN },
          { audience: NotificationAudience.ALL },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  },

  async listForAdminUser(adminId: string, take = 50, cursor?: string) {
    return db.notification.findMany({
      where: {
        OR: [
          { audience: NotificationAudience.ALL },
          { audience: NotificationAudience.ADMIN, userId: null }, // broadcast to all admins
          { audience: NotificationAudience.ADMIN, userId: adminId }, // targeted to this admin
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  },

  async markRead(id: string, userId?: string) {
    // Ensure the notification belongs to the user (if userId provided) unless it's broadcast
    const notif = await db.notification.findUnique({ where: { id } })
    if (!notif) throw new Error('Notification not found')
    if (userId && notif.userId && notif.userId !== userId) {
      throw new Error('Forbidden to mark this notification')
    }
    return db.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    })
  },

  async createBookingAdminNotification(
    bookingId: string,
    invoiceNumber?: string,
  ) {
    return this.create({
      audience: NotificationAudience.ADMIN,
      type: NotificationType.BOOKING_CREATED,
      title: 'New Booking Created',
      message: 'A user has created a new booking.',
      data: { bookingId, invoiceNumber },
    })
  },

  async createPaymentSuccessNotifications(params: {
    invoiceId: string
    invoiceNumber: string
    userId: string
    total: number
    paymentStatus: PaymentStatus
    bookingId?: string
    membershipUserId?: string
    classBookingId?: string
  }) {
    const {
      invoiceId,
      invoiceNumber,
      userId,
      total,
      paymentStatus,
      bookingId,
      membershipUserId,
      classBookingId,
    } = params
    if (paymentStatus !== PaymentStatus.PAID) return

    // User notification
    await this.create({
      userId,
      audience: NotificationAudience.USER,
      type: NotificationType.PAYMENT_SUCCESS,
      title: 'Payment Successful',
      message: `Your payment for invoice ${invoiceNumber} was successful`,
      data: {
        invoiceId,
        invoiceNumber,
        total,
        bookingId,
        membershipUserId,
        classBookingId,
      },
    })

    // Admin notification
    await this.create({
      audience: NotificationAudience.ADMIN,
      type: NotificationType.PAYMENT_SUCCESS,
      title: 'Payment Captured',
      message: `Invoice ${invoiceNumber} was paid`,
      data: { invoiceId, invoiceNumber, total, userId },
    })
  },

  markAllReadForUser: async (userId: string) => {
    return db.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })
  },

  markAllReadForAdmin: async (adminId: string) => {
    return db.notification.updateMany({
      where: {
        OR: [
          { audience: NotificationAudience.ALL },
          { audience: NotificationAudience.ADMIN, userId: null },
          { audience: NotificationAudience.ADMIN, userId: adminId },
        ],
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })
  },
}
