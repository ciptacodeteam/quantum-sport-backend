import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { xenditService } from '@/services/xendit.service'
import { BookingStatus, PaymentStatus } from 'generated/prisma'

interface XenditWebhookPayload {
  id: string
  external_id: string
  status: 'PAID' | 'PENDING' | 'EXPIRED'
  user_id?: string
  merchant_name?: string
  merchant_profile_picture_url?: string
  payer_email?: string
  paid_amount?: number
  currency: string
  payment_method: string
  payment_channel?: string
  paid_at?: string
  create_time: string
  update_time: string
  description?: string
  items?: Array<{
    name: string
    quantity: number
    price: number
    category?: string
  }>
}

export const xenditWebhookHandler = factory.createHandlers(async (c) => {
  try {
    // Verify the callback token
    const callbackToken = c.req.header('x-callback-token')
    
    if (!xenditService.verifyCallbackToken(callbackToken || '')) {
      c.var.logger.error('Invalid Xendit callback token')
      return c.json(
        { error: 'Invalid callback token' },
        401,
      )
    }

    const payload: XenditWebhookPayload = await c.req.json()
    
    c.var.logger.info(`Xendit webhook received: ${payload.status} for ${payload.external_id}`)

    // Find the invoice by external_id (which is our invoice ID)
    const invoice = await db.invoice.findUnique({
      where: { id: payload.external_id },
      include: {
        booking: true,
        payment: true,
      },
    })

    if (!invoice) {
      c.var.logger.error(`Invoice not found: ${payload.external_id}`)
      return c.json(
        { error: 'Invoice not found' },
        404,
      )
    }

    // Update invoice status
    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        status:
          payload.status === 'PAID'
            ? PaymentStatus.PAID
            : payload.status === 'EXPIRED'
              ? PaymentStatus.EXPIRED
              : PaymentStatus.PENDING,
        paidAt: payload.paid_at ? new Date(payload.paid_at) : undefined,
      },
    })

    // Update payment record
    if (invoice.payment) {
      await db.payment.update({
        where: { id: invoice.payment.id },
        data: {
          status:
            payload.status === 'PAID'
              ? PaymentStatus.PAID
              : payload.status === 'EXPIRED'
                ? PaymentStatus.EXPIRED
                : PaymentStatus.PENDING,
          paidAt: payload.paid_at ? new Date(payload.paid_at) : undefined,
          externalRef: payload.id,
        },
      })
    }

    // Update booking status
    if (invoice.bookingId) {
      if (payload.status === 'PAID') {
        await db.booking.update({
          where: { id: invoice.bookingId },
          data: {
            status: BookingStatus.CONFIRMED,
          },
        })
        c.var.logger.info(`Booking confirmed: ${invoice.bookingId}`)
      } else if (payload.status === 'EXPIRED') {
        await db.booking.update({
          where: { id: invoice.bookingId },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: 'Payment expired',
            cancelledAt: new Date(),
          },
        })
        c.var.logger.info(`Booking cancelled due to expired payment: ${invoice.bookingId}`)
      }
    }

    // Handle class bookings
    if (invoice.classBookingId) {
      const classBooking = await db.classBooking.findUnique({
        where: { id: invoice.classBookingId },
      })

      if (classBooking) {
        if (payload.status === 'PAID') {
          await db.classBooking.update({
            where: { id: invoice.classBookingId },
            data: {
              status: BookingStatus.CONFIRMED,
            },
          })
          c.var.logger.info(`Class booking confirmed: ${invoice.classBookingId}`)
        } else if (payload.status === 'EXPIRED') {
          await db.classBooking.update({
            where: { id: invoice.classBookingId },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: 'Payment expired',
              cancelledAt: new Date(),
            },
          })
          c.var.logger.info(`Class booking cancelled: ${invoice.classBookingId}`)
        }
      }
    }

    // Handle membership purchases
    if (invoice.membershipUserId) {
      const membershipUser = await db.membershipUser.findUnique({
        where: { id: invoice.membershipUserId },
      })

      if (membershipUser) {
        if (payload.status === 'PAID') {
          // Membership is already activated, no need to change status
          c.var.logger.info(`Membership payment confirmed: ${invoice.membershipUserId}`)
        } else if (payload.status === 'EXPIRED') {
          // You might want to handle this differently for memberships
          c.var.logger.warn(`Membership payment expired: ${invoice.membershipUserId}`)
        }
      }
    }

    return c.json(ok(null, 'Webhook processed successfully'))
  } catch (error) {
    c.var.logger.fatal(`Error processing Xendit webhook: ${error}`)
    return c.json(
      { error: 'Webhook processing failed' },
      500,
    )
  }
})

