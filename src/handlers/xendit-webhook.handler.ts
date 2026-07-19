import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import {
  XenditPaymentWebhook,
  PaymentSessionWebhook,
  xenditService,
} from '@/services/xendit.service'
import {
  BookingStatus,
  PaymentStatus,
  NotificationAudience,
  NotificationType,
} from '@prisma/client'
import { notificationService } from '@/services/notification.service'
import { sendTemplatedEmail } from '@/services/email.service'
import { env } from '@/env'

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
    const callbackToken =
      c.req.header('x-callback-token') || c.req.header('X-Callback-Token')

    c.var.logger.info(`Xendit webhook received. Has token: ${!!callbackToken}`)

    if (!callbackToken) {
      c.var.logger.error('Missing x-callback-token header')
      return c.json({ error: 'Missing callback token' }, 401)
    }

    if (!xenditService.verifyCallbackToken(callbackToken)) {
      c.var.logger.error(
        `Invalid Xendit callback token. Received token (first 10 chars): ${callbackToken.substring(0, 10)}...`,
      )
      return c.json({ error: 'Invalid callback token' }, 401)
    }

    const payload: any = await c.req.json()

    c.var.logger.info(
      `Xendit webhook received: ${JSON.stringify(payload, null, 2)}`,
    )

    // Check webhook event type
    if (payload.event) {
      // V3 Payment Request webhooks
      if (
        payload.event === 'payment.capture' ||
        payload.event === 'payment.failure'
      ) {
        return await handlePaymentWebhookV3(c, payload as XenditPaymentWebhook)
      }
      // Payment Session webhooks
      else if (
        payload.event === 'payment_session.completed' ||
        payload.event === 'payment_session.expired'
      ) {
        return await handlePaymentSessionWebhook(
          c,
          payload as PaymentSessionWebhook,
        )
      }
    }
    // Legacy v2 invoice webhook
    return await handleInvoiceWebhookV2(c, payload as XenditWebhookPayload)
  } catch (error) {
    c.var.logger.fatal(`Error processing Xendit webhook: ${error}`)
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})

// Handle v3 payment request webhooks
async function handlePaymentWebhookV3(c: any, webhook: XenditPaymentWebhook) {
  const { event, data } = webhook

  c.var.logger.info(
    `Processing v3 payment webhook: ${event} for reference_id: ${data.reference_id}`,
  )

  // Reference id should point to our invoice identifier (id or number)
  if (!data.reference_id) {
    c.var.logger.error('Missing reference_id in v3 payment webhook payload')
    return c.json({ error: 'Missing reference_id' }, 400)
  }

  // For cards payment sessions, reference_id has suffix (e.g., INV-XXX_timestamp-uniqueId)
  // The actual invoice number is in metadata.invoiceNumber
  const invoiceIdentifier = data.metadata?.invoiceNumber || data.reference_id

  c.var.logger.info(
    `Looking up invoice with identifier: ${invoiceIdentifier} (from ${data.metadata?.invoiceNumber ? 'metadata.invoiceNumber' : 'reference_id'})`,
  )

  // Find invoice by id or by number (supports either mapping)
  const invoice = await db.invoice.findFirst({
    where: {
      OR: [{ id: invoiceIdentifier }, { number: invoiceIdentifier }],
    },
    include: {
      booking: true,
      classBooking: true,
      membershipUser: true,
      payment: true,
      user: true,
    },
  })

  if (!invoice) {
    c.var.logger.error(`Invoice not found: ${invoiceIdentifier}`)
    return c.json({ error: 'Invoice not found' }, 404)
  }

  // Determine payment status based on event
  const paymentStatus =
    event === 'payment.capture' ? PaymentStatus.PAID : PaymentStatus.CANCELLED

  const paidAt =
    event === 'payment.capture'
      ? new Date(data.updated || data.created)
      : undefined

  // Update invoice status
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      status: paymentStatus,
      paidAt,
    },
  })

  // Update payment record
  if (invoice.payment) {
    await db.payment.update({
      where: { id: invoice.payment.id },
      data: {
        status: paymentStatus,
        paidAt,
        externalRef: data.payment_id,
        // Store as JSON object (Prisma will serialize it)
        meta: {
          payment_id: data.payment_id,
          payment_request_id: data.payment_request_id,
          reference_id: data.reference_id,
          channel_code: data.channel_code,
          captures: data.captures,
          payment_details: data.payment_details,
          payment_method_id: data.payment_method_id,
          payment_method: data.payment_method,
          failure_code: data.failure_code,
          status: data.status,
          request_amount: data.request_amount,
          currency: data.currency,
          metadata: data.metadata,
          updated: data.updated,
        },
      },
    })
  }

  // Save card details if this is a PAY_AND_SAVE flow with payment_method
  if (
    event === 'payment.capture' &&
    data.payment_method_id &&
    data.payment_method?.card &&
    invoice.userId
  ) {
    const card = data.payment_method.card
    const last4 = card.masked_card_number?.slice(-4) || '****'

    try {
      // Check if card already exists
      const existingCard = await db.userCreditCard.findUnique({
        where: { cardToken: data.payment_method_id },
      })

      if (!existingCard) {
        await db.userCreditCard.create({
          data: {
            userId: invoice.userId,
            cardToken: data.payment_method_id,
            cardBrand: card.card_brand || 'UNKNOWN',
            last4: last4,
            expMonth: card.exp_month,
            expYear: card.exp_year,
            isDefault: false,
          },
        })
        c.var.logger.info(
          `Saved card ${card.card_brand} ending in ${last4} for user ${invoice.userId}`,
        )
      } else {
        c.var.logger.info(
          `Card ${data.payment_method_id} already exists for user ${invoice.userId}`,
        )
      }
    } catch (cardErr) {
      c.var.logger.error(`Failed to save card details: ${cardErr}`)
      // Don't fail the webhook if card save fails
    }
  }

  // Update booking status
  if (invoice.bookingId) {
    if (event === 'payment.capture') {
      // Inventory was already decremented during checkout, no need to decrement again
      await db.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: BookingStatus.CONFIRMED,
        },
      })
      c.var.logger.info(`Booking confirmed: ${invoice.bookingId}`)
    } else if (event === 'payment.failure') {
      // Restore inventory stock when payment fails (it was decremented during checkout)
      const bookingInventories = await db.bookingInventory.findMany({
        where: { bookingId: invoice.bookingId, returnedAt: null },
      })

      for (const bookingInv of bookingInventories) {
        await db.inventory.update({
          where: { id: bookingInv.inventoryId },
          data: {
            quantity: { increment: bookingInv.quantity },
          },
        })
        await db.bookingInventory.update({
          where: { id: bookingInv.id },
          data: { returnedAt: new Date() },
        })
        c.var.logger.info(
          `Restored inventory ${bookingInv.inventoryId} by ${bookingInv.quantity} due to payment failure`,
        )
      }

      await db.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: `Payment failed: ${data.failure_code || 'Unknown error'}`,
          cancelledAt: new Date(),
        },
      })
      await db.bookingBallboy.updateMany({
        where: {
          bookingId: invoice.bookingId,
          status: {
            not: BookingStatus.CANCELLED,
          },
        },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: `Payment failed: ${data.failure_code || 'Unknown error'}`,
          cancelledAt: new Date(),
        },
      })
      await db.bookingCoach.updateMany({
        where: {
          bookingId: invoice.bookingId,
          status: {
            not: BookingStatus.CANCELLED,
          },
        },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: `Payment failed: ${data.failure_code || 'Unknown error'}`,
          cancelledAt: new Date(),
        },
      })
      c.var.logger.info(
        `Booking cancelled due to payment failure: ${invoice.bookingId}`,
      )
    }
  }

  // Handle class bookings
  if (invoice.classBookingId) {
    if (event === 'payment.capture') {
      await db.classBooking.update({
        where: { id: invoice.classBookingId },
        data: {
          status: BookingStatus.CONFIRMED,
        },
      })
      c.var.logger.info(`Class booking confirmed: ${invoice.classBookingId}`)
    } else if (event === 'payment.failure') {
      await db.classBooking.update({
        where: { id: invoice.classBookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: `Payment failed: ${data.failure_code || 'Unknown error'}`,
          cancelledAt: new Date(),
        },
      })
      c.var.logger.info(`Class booking cancelled: ${invoice.classBookingId}`)
    }
  }

  // Handle membership purchases
  if (invoice.membershipUserId) {
    if (event === 'payment.capture') {
      // Membership is already active (created during checkout)
      // Just ensure it's not suspended or expired
      await db.membershipUser.update({
        where: { id: invoice.membershipUserId },
        data: {
          isExpired: false,
          isSuspended: false,
          suspensionReason: null,
          suspensionEndDate: null,
        },
      })
      c.var.logger.info(
        `Membership activated for user: ${invoice.membershipUserId}`,
      )
    } else if (event === 'payment.failure') {
      // Suspend the membership due to payment failure
      await db.membershipUser.update({
        where: { id: invoice.membershipUserId },
        data: {
          isSuspended: true,
          suspensionReason: `Payment failed: ${data.failure_code || 'Unknown error'}`,
          suspensionEndDate: null, // Suspended indefinitely until payment is resolved
        },
      })
      c.var.logger.warn(
        `Membership suspended due to payment failure: ${invoice.membershipUserId}`,
      )
    }
  }

  // Notifications & Email (v3 payment)
  try {
    if (event === 'payment.capture') {
      await notificationService.createPaymentSuccessNotifications({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        userId: invoice.userId,
        total: invoice.total,
        paymentStatus: PaymentStatus.PAID,
        bookingId: invoice.bookingId || undefined,
        membershipUserId: invoice.membershipUserId || undefined,
        classBookingId: invoice.classBookingId || undefined,
      })
      if (invoice.membershipUserId) {
        await notificationService.create({
          userId: invoice.userId,
          audience: NotificationAudience.USER,
          type: NotificationType.MEMBERSHIP_ACTIVATED,
          title: 'Membership Activated',
          message: 'Your membership is now active.',
          data: {
            membershipUserId: invoice.membershipUserId,
            invoiceId: invoice.id,
          },
        })
      }
      if (invoice.user?.email) {
        const invoiceUrl = `${env.frontEndUrl}/invoices/${invoice.id}`
        try {
          await sendTemplatedEmail(invoice.user.email, 'paymentReceipt', {
            name: invoice.user.name || 'User',
            invoiceNumber: invoice.number,
            total: invoice.total,
            invoiceUrl,
          })
        } catch (emailErr) {
          c.var.logger.error(
            `Failed sending payment receipt email: ${emailErr}`,
          )
        }
      }
    } else if (event === 'payment.failure') {
      await notificationService.create({
        userId: invoice.userId,
        audience: NotificationAudience.USER,
        type: NotificationType.PAYMENT_FAILED,
        title: 'Payment Failed',
        message: `Payment for invoice ${invoice.number} failed.`,
        data: { invoiceId: invoice.id, invoiceNumber: invoice.number },
      })
    }
  } catch (notifyErr) {
    c.var.logger.error(`Notification/email processing error: ${notifyErr}`)
  }

  return c.json(ok(null, 'Webhook processed successfully'))
}

// Handle Payment Session webhooks (payment_session.completed, payment_session.expired)
async function handlePaymentSessionWebhook(
  c: any,
  webhook: PaymentSessionWebhook,
) {
  const { event, data } = webhook

  c.var.logger.info(
    `Processing payment session webhook: ${event} for session: ${data.payment_session_id}, reference: ${data.reference_id}`,
  )

  // Get invoice number from metadata or reference_id
  const invoiceNumber = data.metadata?.invoiceNumber || data.reference_id

  if (!invoiceNumber) {
    c.var.logger.error('Missing invoice identifier in payment session webhook')
    return c.json({ error: 'Missing invoice identifier' }, 400)
  }

  // Find invoice
  const invoice = await db.invoice.findFirst({
    where: {
      OR: [{ id: invoiceNumber }, { number: invoiceNumber }],
    },
    include: {
      booking: {
        include: {
          details: { include: { slot: true } },
          coaches: { include: { slot: true } },
          ballboys: { include: { slot: true } },
          inventories: { include: { inventory: true } },
        },
      },
      classBooking: true,
      membershipUser: true,
      payment: true,
      user: true,
    },
  })

  if (!invoice) {
    c.var.logger.error(`Invoice not found: ${invoiceNumber}`)
    return c.json({ error: 'Invoice not found' }, 404)
  }

  // Handle payment_session.completed
  if (event === 'payment_session.completed') {
    c.var.logger.info(
      `Payment session completed for invoice ${invoiceNumber}. Payment ID: ${data.payment_id}`,
    )

    // Update payment metadata with session info
    if (invoice.payment) {
      await db.payment.update({
        where: { id: invoice.payment.id },
        data: {
          meta: {
            ...(typeof invoice.payment.meta === 'object'
              ? invoice.payment.meta
              : {}),
            payment_session_id: data.payment_session_id,
            payment_session_status: data.status,
            payment_session_completed_at: data.updated,
          },
        },
      })
    }

    c.var.logger.info(
      `Payment session ${data.payment_session_id} marked as completed`,
    )

    return c.json(
      ok(null, 'Payment session completed event processed successfully'),
    )
  }

  // Handle payment_session.expired
  if (event === 'payment_session.expired') {
    c.var.logger.warn(
      `Payment session expired for invoice ${invoiceNumber}. Session ID: ${data.payment_session_id}`,
    )

    // Check if payment was already made (prevent duplicate cancellation)
    if (
      invoice.status === PaymentStatus.PAID ||
      invoice.payment?.status === PaymentStatus.PAID
    ) {
      c.var.logger.info(
        `Invoice ${invoiceNumber} is already paid. Ignoring session expiration.`,
      )
      return c.json(
        ok(null, 'Payment already completed, session expiration ignored'),
      )
    }

    // Check if already cancelled
    if (
      invoice.status === PaymentStatus.CANCELLED ||
      invoice.status === PaymentStatus.EXPIRED
    ) {
      c.var.logger.info(
        `Invoice ${invoiceNumber} is already cancelled/expired. Ignoring session expiration.`,
      )
      return c.json(ok(null, 'Invoice already cancelled/expired'))
    }

    await db.$transaction(async (tx) => {
      // Update invoice status to EXPIRED
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: PaymentStatus.EXPIRED,
        },
      })

      // Update payment status to EXPIRED if exists
      if (invoice.payment) {
        await tx.payment.update({
          where: { id: invoice.payment.id },
          data: {
            status: PaymentStatus.EXPIRED,
            meta: {
              ...(typeof invoice.payment.meta === 'object'
                ? invoice.payment.meta
                : {}),
              payment_session_id: data.payment_session_id,
              payment_session_status: 'EXPIRED',
              payment_session_expired_at: data.updated,
            },
          },
        })
      }

      // Handle booking cancellation
      if (invoice.booking) {
        const booking = invoice.booking

        // Release all court slots
        const courtSlotIds = booking.details.map((d) => d.slotId)
        if (courtSlotIds.length > 0) {
          await tx.slot.updateMany({
            where: { id: { in: courtSlotIds } },
            data: { isAvailable: true },
          })
        }

        // Release all coach slots
        const coachSlotIds = booking.coaches.map((c) => c.slotId)
        if (coachSlotIds.length > 0) {
          await tx.slot.updateMany({
            where: { id: { in: coachSlotIds } },
            data: { isAvailable: true },
          })
        }

        // Release all ballboy slots
        const ballboySlotIds = booking.ballboys.map((b) => b.slotId)
        if (ballboySlotIds.length > 0) {
          await tx.slot.updateMany({
            where: { id: { in: ballboySlotIds } },
            data: { isAvailable: true },
          })
        }

        await tx.bookingBallboy.updateMany({
          where: {
            bookingId: booking.id,
            status: {
              not: BookingStatus.CANCELLED,
            },
          },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: 'Payment session expired - no payment made',
            cancelledAt: new Date(),
          },
        })

        await tx.bookingCoach.updateMany({
          where: {
            bookingId: booking.id,
            status: {
              not: BookingStatus.CANCELLED,
            },
          },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: 'Payment session expired - no payment made',
            cancelledAt: new Date(),
          },
        })

        // Restore inventory quantities
        for (const bookingInv of booking.inventories.filter(
          (inventory) => !inventory.returnedAt,
        )) {
          await tx.inventory.update({
            where: { id: bookingInv.inventoryId },
            data: {
              quantity: { increment: bookingInv.quantity },
            },
          })
          await tx.bookingInventory.update({
            where: { id: bookingInv.id },
            data: { returnedAt: new Date() },
          })
        }

        // Cancel booking
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: 'Payment session expired - no payment made',
            cancelledAt: new Date(),
          },
        })

        c.var.logger.info(
          `Booking ${booking.id} cancelled due to payment session expiration. Resources restored.`,
        )
      }

      // Handle class booking cancellation
      if (invoice.classBooking) {
        await tx.classBooking.update({
          where: { id: invoice.classBooking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: 'Payment session expired - no payment made',
            cancelledAt: new Date(),
          },
        })

        // Restore class capacity
        await tx.class.update({
          where: { id: invoice.classBooking.classId },
          data: {
            remaining: { increment: 1 },
          },
        })

        c.var.logger.info(
          `Class booking ${invoice.classBooking.id} cancelled and capacity restored`,
        )
      }

      // Handle membership cancellation
      if (invoice.membershipUser) {
        await tx.membershipUser.delete({
          where: { id: invoice.membershipUser.id },
        })

        c.var.logger.info(
          `Membership ${invoice.membershipUser.id} deleted due to payment session expiration`,
        )
      }
    })

    // Send notification to user
    try {
      await notificationService.create({
        userId: invoice.userId,
        audience: NotificationAudience.USER,
        type: NotificationType.PAYMENT_FAILED,
        title: 'Payment Session Expired',
        message:
          'Your payment session has expired. Your booking has been cancelled.',
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          reason: 'Payment session expired',
        },
      })
    } catch (notifyErr) {
      c.var.logger.error(
        `Failed to send session expiration notification: ${notifyErr}`,
      )
    }

    c.var.logger.info(
      `Payment session ${data.payment_session_id} expiration processed successfully`,
    )

    return c.json(
      ok(null, 'Payment session expired event processed successfully'),
    )
  }

  return c.json(ok(null, 'Payment session webhook processed'))
}

// Handle legacy v2 invoice webhooks
async function handleInvoiceWebhookV2(c: any, payload: XenditWebhookPayload) {
  c.var.logger.info(
    `Processing v2 invoice webhook: ${payload.status} for ${payload.external_id}`,
  )

  // external_id should point to our invoice identifier (id or number)
  if (!payload.external_id) {
    c.var.logger.error('Missing external_id in v2 invoice webhook payload')
    return c.json({ error: 'Missing external_id' }, 400)
  }

  // Find invoice by id or by number (supports either mapping)
  const invoice = await db.invoice.findFirst({
    where: {
      OR: [{ id: payload.external_id }, { number: payload.external_id }],
    },
    include: {
      booking: true,
      classBooking: true,
      membershipUser: true,
      payment: true,
      user: true,
    },
  })

  if (!invoice) {
    c.var.logger.error(`Invoice not found: ${payload.external_id}`)
    return c.json({ error: 'Invoice not found' }, 404)
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
      // Inventory was already decremented during checkout, no need to decrement again
      await db.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: BookingStatus.CONFIRMED,
        },
      })
      c.var.logger.info(`Booking confirmed: ${invoice.bookingId}`)
    } else if (payload.status === 'EXPIRED') {
      // Restore inventory stock when payment expires (it was decremented during checkout)
      const bookingInventories = await db.bookingInventory.findMany({
        where: { bookingId: invoice.bookingId, returnedAt: null },
      })

      for (const bookingInv of bookingInventories) {
        await db.inventory.update({
          where: { id: bookingInv.inventoryId },
          data: {
            quantity: { increment: bookingInv.quantity },
          },
        })
        await db.bookingInventory.update({
          where: { id: bookingInv.id },
          data: { returnedAt: new Date() },
        })
        c.var.logger.info(
          `Restored inventory ${bookingInv.inventoryId} by ${bookingInv.quantity} due to payment expiration`,
        )
      }

      await db.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: 'Payment expired',
          cancelledAt: new Date(),
        },
      })
      await db.bookingBallboy.updateMany({
        where: {
          bookingId: invoice.bookingId,
          status: {
            not: BookingStatus.CANCELLED,
          },
        },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: 'Payment expired',
          cancelledAt: new Date(),
        },
      })
      await db.bookingCoach.updateMany({
        where: {
          bookingId: invoice.bookingId,
          status: {
            not: BookingStatus.CANCELLED,
          },
        },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: 'Payment expired',
          cancelledAt: new Date(),
        },
      })
      c.var.logger.info(
        `Booking cancelled due to expired payment: ${invoice.bookingId}`,
      )
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
        // Membership is already active (created during checkout)
        // Just ensure it's not suspended or expired
        await db.membershipUser.update({
          where: { id: invoice.membershipUserId },
          data: {
            isExpired: false,
            isSuspended: false,
            suspensionReason: null,
            suspensionEndDate: null,
          },
        })
        c.var.logger.info(
          `Membership activated for user: ${invoice.membershipUserId}`,
        )
      } else if (payload.status === 'EXPIRED') {
        // Suspend the membership due to payment expiration
        await db.membershipUser.update({
          where: { id: invoice.membershipUserId },
          data: {
            isSuspended: true,
            suspensionReason: 'Payment expired',
            suspensionEndDate: null, // Suspended indefinitely
          },
        })
        c.var.logger.warn(
          `Membership suspended due to payment expiration: ${invoice.membershipUserId}`,
        )
      }
    }
  }

  // Notifications & Email (v2 invoice)
  try {
    if (payload.status === 'PAID') {
      await notificationService.createPaymentSuccessNotifications({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        userId: invoice.userId,
        total: invoice.total,
        paymentStatus: PaymentStatus.PAID,
        bookingId: invoice.bookingId || undefined,
        membershipUserId: invoice.membershipUserId || undefined,
        classBookingId: invoice.classBookingId || undefined,
      })
      if (invoice.membershipUserId) {
        await notificationService.create({
          userId: invoice.userId,
          audience: NotificationAudience.USER,
          type: NotificationType.MEMBERSHIP_ACTIVATED,
          title: 'Membership Activated',
          message: 'Your membership is now active.',
          data: {
            membershipUserId: invoice.membershipUserId,
            invoiceId: invoice.id,
          },
        })
      }
      if (invoice.user?.email) {
        const invoiceUrl = `${env.frontEndUrl}/invoices/${invoice.id}`
        try {
          await sendTemplatedEmail(invoice.user.email, 'paymentReceipt', {
            name: invoice.user.name || 'User',
            invoiceNumber: invoice.number,
            total: invoice.total,
            invoiceUrl,
          })
        } catch (emailErr) {
          c.var.logger.error(
            `Failed sending payment receipt email: ${emailErr}`,
          )
        }
      }
    } else if (payload.status === 'EXPIRED') {
      await notificationService.create({
        userId: invoice.userId,
        audience: NotificationAudience.USER,
        type: NotificationType.PAYMENT_FAILED,
        title: 'Payment Expired',
        message: `Payment for invoice ${invoice.number} expired.`,
        data: { invoiceId: invoice.id, invoiceNumber: invoice.number },
      })
    }
  } catch (notifyErr) {
    c.var.logger.error(`Notification/email processing error (v2): ${notifyErr}`)
  }

  return c.json(ok(null, 'Webhook processed successfully'))
}

// ==================== NEW V3 WEBHOOK HANDLERS ====================

// Payment Token Webhook Types
interface XenditPaymentTokenWebhook {
  created: string
  business_id: string
  event: 'payment_token.activation' | 'payment_token.deactivation'
  api_version: string
  data: {
    status: 'ACTIVE' | 'INACTIVE'
    payment_token_id: string
    reference_id: string
    currency: string
    country: string
    created: string
    updated: string
    channel_code: string
    channel_properties: any
    token_details?: any
  }
}

// Payment Request Webhook Types
interface XenditPaymentRequestWebhook {
  created: string
  business_id: string
  event:
    | 'payment_request.created'
    | 'payment_request.completed'
    | 'payment_request.failed'
    | 'payment_request.expired'
  api_version: string
  data: {
    id: string
    reference_id: string
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED'
    amount: number
    currency: string
    country: string
    payment_method: any
    created: string
    updated: string
  }
}

// Payment Status Webhook Types (existing)
interface XenditPaymentStatusWebhook {
  created: string
  business_id: string
  event: 'payment.capture' | 'payment.failure'
  api_version: string
  data: {
    id: string
    reference_id: string
    payment_request_id: string
    status: 'SUCCEEDED' | 'FAILED'
    amount: number
    currency: string
    channel_code: string
    created: string
    updated?: string
    failure_code?: string
  }
}

// Handler for Payment Token Status webhooks
export const xenditPaymentTokenWebhookHandler = factory.createHandlers(
  async (c) => {
    try {
      // Verify callback token
      const callbackToken =
        c.req.header('x-callback-token') || c.req.header('X-Callback-Token')

      c.var.logger.info(
        `Xendit Payment Token webhook received. Has token: ${!!callbackToken}`,
      )

      if (!callbackToken) {
        c.var.logger.error('Missing x-callback-token header')
        return c.json({ error: 'Missing callback token' }, 401)
      }

      if (!xenditService.verifyCallbackToken(callbackToken)) {
        c.var.logger.error(`Invalid Xendit callback token`)
        return c.json({ error: 'Invalid callback token' }, 401)
      }

      const payload: XenditPaymentTokenWebhook = await c.req.json()

      c.var.logger.info(
        `Payment Token webhook received: ${payload.event} for token: ${payload.data.payment_token_id}`,
      )

      // Log the payment token event
      // In the future, you might want to store these tokens for recurring payments
      c.var.logger.info(
        `Payment Token ${payload.data.status}: ${payload.data.reference_id}`,
      )

      return c.json(ok(null, 'Payment token webhook processed'))
    } catch (error) {
      c.var.logger.fatal(`Error processing payment token webhook: ${error}`)
      return c.json({ error: 'Webhook processing failed' }, 500)
    }
  },
)

// Handler for Payment Request Status webhooks
export const xenditPaymentRequestWebhookHandler = factory.createHandlers(
  async (c) => {
    try {
      // Verify callback token
      const callbackToken =
        c.req.header('x-callback-token') || c.req.header('X-Callback-Token')

      c.var.logger.info(
        `Xendit Payment Request webhook received. Has token: ${!!callbackToken}`,
      )

      if (!callbackToken) {
        c.var.logger.error('Missing x-callback-token header')
        return c.json({ error: 'Missing callback token' }, 401)
      }

      if (!xenditService.verifyCallbackToken(callbackToken)) {
        c.var.logger.error(`Invalid Xendit callback token`)
        return c.json({ error: 'Invalid callback token' }, 401)
      }

      const payload: XenditPaymentRequestWebhook = await c.req.json()

      c.var.logger.info(
        `Payment Request webhook received: ${payload.event} for reference: ${payload.data.reference_id}`,
      )

      // Find invoice by reference_id
      if (!payload.data.reference_id) {
        c.var.logger.error('Missing reference_id in payment request webhook')
        return c.json({ error: 'Missing reference_id' }, 400)
      }

      const invoice = await db.invoice.findFirst({
        where: {
          OR: [
            { id: payload.data.reference_id },
            { number: payload.data.reference_id },
          ],
        },
        include: {
          payment: true,
          booking: true,
          classBooking: true,
          membershipUser: true,
          user: true,
        },
      })

      if (!invoice) {
        c.var.logger.error(`Invoice not found: ${payload.data.reference_id}`)
        return c.json({ error: 'Invoice not found' }, 404)
      }

      // Map payment request status to our payment status
      let paymentStatus: PaymentStatus
      switch (payload.data.status) {
        case 'COMPLETED':
          paymentStatus = PaymentStatus.PAID
          break
        case 'FAILED':
          paymentStatus = PaymentStatus.CANCELLED
          break
        case 'EXPIRED':
          paymentStatus = PaymentStatus.EXPIRED
          break
        default:
          paymentStatus = PaymentStatus.PENDING
      }

      // Update invoice
      await db.invoice.update({
        where: { id: invoice.id },
        data: {
          status: paymentStatus,
          paidAt:
            payload.data.status === 'COMPLETED'
              ? new Date(payload.data.updated)
              : undefined,
        },
      })

      // Update payment record
      if (invoice.payment) {
        await db.payment.update({
          where: { id: invoice.payment.id },
          data: {
            status: paymentStatus,
            paidAt:
              payload.data.status === 'COMPLETED'
                ? new Date(payload.data.updated)
                : undefined,
            meta: {
              ...(typeof invoice.payment.meta === 'object'
                ? invoice.payment.meta
                : {}),
              payment_request_id: payload.data.id,
              payment_request_status: payload.data.status,
              payment_request_event: payload.event,
            },
          },
        })
      }

      // Handle business logic based on status
      if (payload.data.status === 'COMPLETED') {
        // Update booking status
        if (invoice.bookingId) {
          // Inventory was already decremented during checkout, no need to decrement again
          await db.booking.update({
            where: { id: invoice.bookingId },
            data: { status: BookingStatus.CONFIRMED },
          })
          c.var.logger.info(`Booking confirmed: ${invoice.bookingId}`)
        }

        // Update class booking status
        if (invoice.classBookingId) {
          await db.classBooking.update({
            where: { id: invoice.classBookingId },
            data: { status: BookingStatus.CONFIRMED },
          })
          c.var.logger.info(
            `Class booking confirmed: ${invoice.classBookingId}`,
          )
        }

        // Activate membership
        if (invoice.membershipUserId) {
          await db.membershipUser.update({
            where: { id: invoice.membershipUserId },
            data: {
              isExpired: false,
              isSuspended: false,
              suspensionReason: null,
              suspensionEndDate: null,
            },
          })
          c.var.logger.info(`Membership activated: ${invoice.membershipUserId}`)
        }
      } else if (
        payload.data.status === 'FAILED' ||
        payload.data.status === 'EXPIRED'
      ) {
        // Cancel bookings and restore inventory
        if (invoice.bookingId) {
          // Restore inventory stock when payment fails/expires (it was decremented during checkout)
          const bookingInventories = await db.bookingInventory.findMany({
            where: { bookingId: invoice.bookingId, returnedAt: null },
          })

          for (const bookingInv of bookingInventories) {
            await db.inventory.update({
              where: { id: bookingInv.inventoryId },
              data: {
                quantity: { increment: bookingInv.quantity },
              },
            })
            await db.bookingInventory.update({
              where: { id: bookingInv.id },
              data: { returnedAt: new Date() },
            })
            c.var.logger.info(
              `Restored inventory ${bookingInv.inventoryId} by ${bookingInv.quantity} due to payment ${payload.data.status.toLowerCase()}`,
            )
          }

          await db.booking.update({
            where: { id: invoice.bookingId },
            data: { status: BookingStatus.CANCELLED },
          })
          await db.bookingBallboy.updateMany({
            where: {
              bookingId: invoice.bookingId,
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: `Payment ${payload.data.status.toLowerCase()}`,
              cancelledAt: new Date(),
            },
          })
          await db.bookingCoach.updateMany({
            where: {
              bookingId: invoice.bookingId,
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: `Payment ${payload.data.status.toLowerCase()}`,
              cancelledAt: new Date(),
            },
          })
          c.var.logger.warn(`Booking cancelled: ${invoice.bookingId}`)
        }

        if (invoice.classBookingId) {
          await db.classBooking.update({
            where: { id: invoice.classBookingId },
            data: { status: BookingStatus.CANCELLED },
          })
          c.var.logger.warn(
            `Class booking cancelled: ${invoice.classBookingId}`,
          )
        }

        // Suspend membership
        if (invoice.membershipUserId) {
          await db.membershipUser.update({
            where: { id: invoice.membershipUserId },
            data: {
              isSuspended: true,
              suspensionReason: `Payment ${payload.data.status.toLowerCase()}`,
              suspensionEndDate: null,
            },
          })
          c.var.logger.warn(`Membership suspended: ${invoice.membershipUserId}`)
        }
      }

      // Notifications & Email (payment request)
      try {
        if (payload.data.status === 'COMPLETED') {
          await notificationService.createPaymentSuccessNotifications({
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            userId: invoice.userId,
            total: invoice.total,
            paymentStatus: PaymentStatus.PAID,
            bookingId: invoice.bookingId || undefined,
            membershipUserId: invoice.membershipUserId || undefined,
            classBookingId: invoice.classBookingId || undefined,
          })
          if (invoice.membershipUserId) {
            await notificationService.create({
              userId: invoice.userId,
              audience: NotificationAudience.USER,
              type: NotificationType.MEMBERSHIP_ACTIVATED,
              title: 'Membership Activated',
              message: 'Your membership is now active.',
              data: {
                membershipUserId: invoice.membershipUserId,
                invoiceId: invoice.id,
              },
            })
          }
          if (invoice.user?.email) {
            const invoiceUrl = `${env.frontEndUrl}/invoices/${invoice.id}`
            try {
              await sendTemplatedEmail(invoice.user.email, 'paymentReceipt', {
                name: invoice.user.name || 'User',
                invoiceNumber: invoice.number,
                total: invoice.total,
                invoiceUrl,
              })
            } catch (emailErr) {
              c.var.logger.error(
                `Failed sending payment receipt email: ${emailErr}`,
              )
            }
          }
        } else if (
          payload.data.status === 'FAILED' ||
          payload.data.status === 'EXPIRED'
        ) {
          await notificationService.create({
            userId: invoice.userId,
            audience: NotificationAudience.USER,
            type: NotificationType.PAYMENT_FAILED,
            title:
              payload.data.status === 'FAILED'
                ? 'Payment Failed'
                : 'Payment Expired',
            message: `Payment for invoice ${invoice.number} ${payload.data.status.toLowerCase()}.`,
            data: { invoiceId: invoice.id, invoiceNumber: invoice.number },
          })
        }
      } catch (notifyErr) {
        c.var.logger.error(
          `Notification/email processing error (payment request): ${notifyErr}`,
        )
      }

      return c.json(ok(null, 'Payment request webhook processed'))
    } catch (error) {
      c.var.logger.fatal(`Error processing payment request webhook: ${error}`)
      return c.json({ error: 'Webhook processing failed' }, 500)
    }
  },
)

// Handler for Payment Status webhooks (renamed from existing)
export const xenditPaymentStatusWebhookHandler = factory.createHandlers(
  async (c) => {
    try {
      // Verify callback token
      const callbackToken =
        c.req.header('x-callback-token') || c.req.header('X-Callback-Token')

      c.var.logger.info(
        `Xendit Payment Status webhook received. Has token: ${!!callbackToken}`,
      )

      if (!callbackToken) {
        c.var.logger.error('Missing x-callback-token header')
        return c.json({ error: 'Missing callback token' }, 401)
      }

      if (!xenditService.verifyCallbackToken(callbackToken)) {
        c.var.logger.error(`Invalid Xendit callback token`)
        return c.json({ error: 'Invalid callback token' }, 401)
      }

      const payload: XenditPaymentStatusWebhook = await c.req.json()

      c.var.logger.info(
        `Payment Status webhook received: ${payload.event} for reference: ${payload.data.reference_id}`,
      )

      // Use the existing v3 payment handler
      return await handlePaymentWebhookV3(c, payload as any)
    } catch (error) {
      c.var.logger.fatal(`Error processing payment status webhook: ${error}`)
      return c.json({ error: 'Webhook processing failed' }, 500)
    }
  },
)
