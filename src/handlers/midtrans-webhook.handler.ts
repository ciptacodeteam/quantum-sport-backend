import { env, isDeployedEnv } from '@/env'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import {
  amountsMatch,
  isPaidStatus,
  midtransService,
  validSignature,
} from '@/services/midtrans.service'
import {
  applyPaymentTerminalFailure,
  finalizeSuccessfulPayment,
} from '@/services/payment-reconcile.service'
import { notificationService } from '@/services/notification.service'
import { sendTemplatedEmail } from '@/services/email.service'
import { discardUnpaidMembership } from '@/services/membership-activation.service'
import {
  cancelHoldBookingAndReleaseResources,
  cancelHoldClassBookingAndRestoreCapacity,
} from '@/services/booking-cancel.service'
import {
  NotificationAudience,
  NotificationType,
  PaymentStatus,
} from '@prisma/client'

export const midtransFinishHandler = factory.createHandlers((c) => {
  const invoiceList =
    isDeployedEnv()
      ? `${env.frontEndUrl.replace(/\/$/, '')}/invoice`
      : 'http://localhost:3000/invoice'
  return c.redirect(invoiceList, 303)
})

export const midtransClientConfigHandler = factory.createHandlers(async (c) => {
  if (!env.midtrans.clientKey) {
    return c.json({ success: false, msg: 'Payment config unavailable' }, 503)
  }
  return c.json(ok(midtransService.clientConfig()))
})

export const midtransWebhookHandler = factory.createHandlers(async (c) => {
  const notification = await c.req.json().catch(() => null)
  if (!notification || typeof notification !== 'object') {
    return c.json({ error: 'invalid body' }, 400)
  }
  if (!validSignature(notification, env.midtrans.serverKey)) {
    c.var.logger.warn('Midtrans notification rejected: bad signature')
    return c.json({ error: 'invalid signature' }, 403)
  }
  if (
    env.midtrans.merchantId &&
    notification.merchant_id &&
    notification.merchant_id !== env.midtrans.merchantId
  ) {
    return c.json({ error: 'invalid merchant' }, 403)
  }

  const orderId = String(notification.order_id || '')
  const invoice = await db.invoice.findFirst({
    where: { number: orderId },
    include: {
      payment: true,
      booking: true,
      classBooking: true,
      membershipUser: true,
      user: true,
    },
  })
  if (!invoice) {
    c.var.logger.warn(`Midtrans notification for unknown order ${orderId}`)
    return c.json({ received: true }, 200)
  }
  if (!amountsMatch(notification.gross_amount, invoice.total)) {
    c.var.logger.error(
      `Midtrans amount mismatch for ${invoice.number}: ${notification.gross_amount} vs ${invoice.total}`,
    )
    return c.json({ error: 'amount mismatch' }, 400)
  }

  let remote
  try {
    remote = await midtransService.getStatus(orderId)
  } catch (error) {
    c.var.logger.error(`Midtrans status check failed for ${orderId}: ${error}`)
    return c.json({ error: 'status check failed' }, 500)
  }
  if (!remote) return c.json({ received: true }, 200)
  if (!remote.transaction_status) {
    c.var.logger.error(
      `Midtrans status for ${orderId} had no transaction_status: ${remote.status_code} ${remote.status_message}`,
    )
    return c.json({ error: 'status check failed' }, 500)
  }

  const transactionStatus = String(remote.transaction_status || '').toLowerCase()
  const fraudStatus = String(remote.fraud_status || '').toLowerCase()
  const metaPatch = {
    gateway: 'midtrans',
    order_id: orderId,
    transaction_id: remote.transaction_id,
    transaction_status: transactionStatus,
    fraud_status: fraudStatus,
  }

  if (isPaidStatus(transactionStatus, fraudStatus)) {
    const finalizeResult = await db.$transaction((tx) =>
      finalizeSuccessfulPayment(tx, {
        invoiceId: invoice.id,
        externalRef: String(remote.transaction_id || ''),
        metaPatch,
      }),
    )
    c.var.logger.info(
      `midtrans paid finalize for ${invoice.number}: ${finalizeResult.outcome}`,
    )
    if (finalizeResult.outcome !== 'already_paid') {
      try {
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
        if (invoice.membershipUserId && finalizeResult.outcome === 'confirmed') {
          await notificationService.create({
            userId: invoice.userId,
            audience: NotificationAudience.USER,
            type: NotificationType.MEMBERSHIP_ACTIVATED,
            title: 'Membership Activated',
            message: 'Your membership is now active.',
            data: { membershipUserId: invoice.membershipUserId, invoiceId: invoice.id },
          })
        }
        if (finalizeResult.outcome === 'paid_needs_manual_review') {
          await notificationService.create({
            userId: invoice.userId,
            audience: NotificationAudience.ADMIN,
            type: NotificationType.PAYMENT_FAILED,
            title: 'Late payment needs review',
            message: `Invoice ${invoice.number} paid at Midtrans but booking could not be auto-confirmed: ${finalizeResult.reason}`,
            data: {
              invoiceId: invoice.id,
              invoiceNumber: invoice.number,
              reason: finalizeResult.reason,
            },
          })
        }
        if (invoice.user?.email && finalizeResult.outcome === 'confirmed') {
          await sendTemplatedEmail(invoice.user.email, 'paymentReceipt', {
            name: invoice.user.name || 'User',
            invoiceNumber: invoice.number,
            total: invoice.total,
            invoiceUrl: `${env.frontEndUrl}/invoices/${invoice.id}`,
          }).catch((emailErr) => {
            c.var.logger.error(`Failed sending payment receipt email: ${emailErr}`)
          })
        }
      } catch (notifyErr) {
        c.var.logger.error(`Midtrans notification side effects failed: ${notifyErr}`)
      }
    }
    return c.json(ok(null, 'Payment notification processed'))
  }

  if (transactionStatus === 'capture' && fraudStatus === 'challenge') {
    c.var.logger.warn(`Midtrans card ${orderId} is challenged and was not fulfilled`)
    return c.json({ received: true }, 200)
  }

  if (['deny', 'cancel', 'expire', 'failure'].includes(transactionStatus)) {
    if (invoice.status === PaymentStatus.PAID) {
      c.var.logger.warn(
        `Midtrans ${transactionStatus} arrived after ${invoice.number} was paid; left paid`,
      )
      return c.json({ received: true }, 200)
    }
    const terminalStatus =
      transactionStatus === 'expire' ? PaymentStatus.EXPIRED : PaymentStatus.CANCELLED
    const reason = `Payment ${transactionStatus}`
    let applied = false
    await db.$transaction(async (tx) => {
      const terminal = await applyPaymentTerminalFailure(tx, {
        invoiceId: invoice.id,
        status: terminalStatus,
        reason,
        metaPatch,
      })
      if (!terminal.applied) return
      applied = true
      if (invoice.bookingId) {
        await cancelHoldBookingAndReleaseResources(tx, {
          bookingId: invoice.bookingId,
          reason,
        })
      }
      if (invoice.classBookingId) {
        await cancelHoldClassBookingAndRestoreCapacity(tx, {
          classBookingId: invoice.classBookingId,
          reason,
        })
      }
      if (invoice.membershipUserId) {
        await discardUnpaidMembership(tx, invoice.membershipUserId)
      }
    })
    if (applied) {
      await notificationService
        .create({
          userId: invoice.userId,
          audience: NotificationAudience.USER,
          type: NotificationType.PAYMENT_FAILED,
          title: transactionStatus === 'expire' ? 'Payment Expired' : 'Payment Failed',
          message: `Payment for invoice ${invoice.number} ${transactionStatus}.`,
          data: { invoiceId: invoice.id, invoiceNumber: invoice.number },
        })
        .catch((error) => c.var.logger.error(`Midtrans failure notice: ${error}`))
    }
  }

  return c.json({ received: true }, 200)
})
