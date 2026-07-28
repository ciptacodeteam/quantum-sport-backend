import { Queue, Worker } from 'bullmq'
import { db } from '@/lib/prisma'
import { BookingStatus, PaymentStatus } from '@prisma/client'
import { log } from '@/lib/logger'
import { getRedisConnection } from '@/lib/redis'
import {
  cancelHoldBookingAndReleaseResources,
  cancelHoldClassBookingAndRestoreCapacity,
} from '@/services/booking-cancel.service'
import { discardUnpaidMembership } from '@/services/membership-activation.service'
import {
  finalizeSuccessfulPayment,
  isGatewayPaymentCompleted,
} from '@/services/payment-reconcile.service'

let redisConnection = getRedisConnection()

/** Grace period after dueDate before local expiry — reduces race with in-flight Xendit captures */
const EXPIRY_GRACE_MS = 2 * 60 * 1000

// Queue for scheduled tasks
let schedulerQueue = new Queue('scheduler', {
  connection: redisConnection,
})

/**
 * Reconnect to Redis (handles role changes like master -> replica failover)
 * This is called when we detect connection issues that might be due to Redis role changes
 */
function reconnectRedis() {
  try {
    log.warn('Attempting to reconnect to Redis...')
    redisConnection = getRedisConnection()
    schedulerQueue = new Queue('scheduler', {
      connection: redisConnection,
    })
    log.info('Successfully reconnected to Redis')
  } catch (error) {
    log.error(`Failed to reconnect to Redis: ${error}`)
    throw error
  }
}

const UNPAID_PAYMENT_STATUSES = [
  PaymentStatus.PENDING,
  PaymentStatus.AWAITING_CONFIRMATION,
] as const

/**
 * Check for expired payments and update their status
 * This runs every minute to check for:
 * - Payments past their dueDate still unpaid (PENDING / AWAITING_CONFIRMATION)
 * - Related HOLD bookings / class bookings / unpaid memberships
 * - Bookings past their holdExpiresAt with HOLD status
 *
 * Finalized payments (EXPIRED / CANCELLED / PAID / REFUNDED) are never
 * reprocessed, so slot release cannot undo a newer booking on the same slots.
 */
export async function checkExpiredTransactions() {
  const now = new Date()
  const expireBefore = new Date(now.getTime() - EXPIRY_GRACE_MS)

  try {
    // Only unpaid payments — never reprocess EXPIRED/CANCELLED rows
    const expiredPayments = await db.payment.findMany({
      where: {
        status: {
          in: [...UNPAID_PAYMENT_STATUSES],
        },
        dueDate: {
          lte: expireBefore,
        },
      },
      include: {
        invoice: {
          include: {
            booking: true,
            classBooking: true,
            membershipUser: true,
          },
        },
      },
    })

    log.info(`Found ${expiredPayments.length} expired payments to process`)

    let expiredPaymentCount = 0
    let reconciledLatePaidCount = 0

    for (const payment of expiredPayments) {
      // If Xendit already captured, reconcile instead of expiring
      if (payment.invoice && (await isGatewayPaymentCompleted(payment))) {
        const result = await db.$transaction(async (tx) =>
          finalizeSuccessfulPayment(tx, {
            invoiceId: payment.invoice!.id,
            paidAt: now,
            metaPatch: {
              reconciled_by: 'scheduler_gateway_check',
            },
          }),
        )
        reconciledLatePaidCount += 1
        log.info(
          `Reconciled late gateway payment ${payment.id} → ${result.outcome}`,
        )
        continue
      }

      await db.$transaction(async (tx) => {
        // Claim this payment once — concurrent/repeated runs skip if already finalized
        const claimedPayment = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: { in: [...UNPAID_PAYMENT_STATUSES] },
          },
          data: {
            status: PaymentStatus.EXPIRED,
          },
        })

        if (claimedPayment.count === 0) {
          return
        }

        if (payment.invoice) {
          await tx.invoice.updateMany({
            where: {
              id: payment.invoice.id,
              status: { in: [...UNPAID_PAYMENT_STATUSES] },
            },
            data: {
              status: PaymentStatus.EXPIRED,
            },
          })

          if (payment.invoice.booking) {
            const { cancelled } = await cancelHoldBookingAndReleaseResources(
              tx,
              {
                bookingId: payment.invoice.booking.id,
                reason: 'Payment expired',
                now,
              },
            )

            if (!cancelled) {
              log.warn(
                `Skipped slot release for payment ${payment.id}: booking ${payment.invoice.booking.id} is not HOLD`,
              )
            }
          }

          if (payment.invoice.classBooking) {
            await cancelHoldClassBookingAndRestoreCapacity(tx, {
              classBookingId: payment.invoice.classBooking.id,
              reason: 'Payment expired',
              now,
            })
          }

          // Delete membership user if payment expired (not yet paid)
          if (payment.invoice.membershipUser) {
            await discardUnpaidMembership(
              tx,
              payment.invoice.membershipUser.id,
            )
            log.info(
              `Deleted unpaid membership ${payment.invoice.membershipUser.id}`,
            )
          }
        }

        expiredPaymentCount += 1
        log.info(`Expired payment ${payment.id} and related records`)
      })
    }

    // Also check for bookings with expired holdExpiresAt (backup check)
    const expiredHoldBookings = await db.booking.findMany({
      where: {
        status: BookingStatus.HOLD,
        holdExpiresAt: {
          lte: expireBefore,
        },
      },
    })

    log.info(
      `Found ${expiredHoldBookings.length} expired hold bookings to process`,
    )

    let expiredHoldCount = 0

    for (const booking of expiredHoldBookings) {
      await db.$transaction(async (tx) => {
        const { cancelled } = await cancelHoldBookingAndReleaseResources(tx, {
          bookingId: booking.id,
          reason: 'Hold period expired',
          now,
        })

        if (!cancelled) {
          return
        }

        // Expire related unpaid invoice + payment if still unpaid
        const invoice = await tx.invoice.findFirst({
          where: { bookingId: booking.id },
          include: { payment: true },
        })
        if (
          invoice &&
          (UNPAID_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(
            invoice.status,
          )
        ) {
          await tx.invoice.updateMany({
            where: {
              id: invoice.id,
              status: { in: [...UNPAID_PAYMENT_STATUSES] },
            },
            data: { status: PaymentStatus.EXPIRED },
          })

          if (invoice.paymentId) {
            await tx.payment.updateMany({
              where: {
                id: invoice.paymentId,
                status: { in: [...UNPAID_PAYMENT_STATUSES] },
              },
              data: { status: PaymentStatus.EXPIRED },
            })
          }
        }

        expiredHoldCount += 1
      })
    }

    return {
      expiredPayments: expiredPaymentCount,
      expiredHoldBookings: expiredHoldCount,
      reconciledLatePaid: reconciledLatePaidCount,
    }
  } catch (error) {
    log.error(`Error checking expired transactions: ${error}`)
    throw error
  }
}

/**
 * Restore racket/equipment stock once the booked court session has finished.
 * Inventory bookings without a slotId are legacy records and keep the old
 * cancellation-based restore behavior.
 */
export async function restoreCompletedInventorySessions() {
  const now = new Date()

  const completedInventoryBookings = await db.bookingInventory.findMany({
    where: {
      returnedAt: null,
      slotId: { not: null },
      booking: {
        status: BookingStatus.CONFIRMED,
      },
      slot: {
        endAt: {
          lte: now,
        },
      },
    },
    select: {
      id: true,
      inventoryId: true,
      quantity: true,
      slotId: true,
      bookingId: true,
    },
  })

  for (const bookingInventory of completedInventoryBookings) {
    await db.$transaction(async (tx) => {
      const marked = await tx.bookingInventory.updateMany({
        where: {
          id: bookingInventory.id,
          returnedAt: null,
        },
        data: {
          returnedAt: now,
        },
      })

      if (marked.count === 0) {
        return
      }

      await tx.inventory.update({
        where: { id: bookingInventory.inventoryId },
        data: {
          quantity: { increment: bookingInventory.quantity },
        },
      })
    })

    log.info(
      `Restored inventory ${bookingInventory.inventoryId} by ${bookingInventory.quantity} after session ${bookingInventory.slotId} ended for booking ${bookingInventory.bookingId}`,
    )
  }

  return {
    restoredInventoryBookings: completedInventoryBookings.length,
  }
}

/**
 * Add a job to check expired transactions every minute
 */
export async function scheduleExpiryCheck() {
  try {
    // Remove existing repeatable jobs with the same pattern
    const repeatableJobs = await schedulerQueue.getRepeatableJobs()
    for (const job of repeatableJobs) {
      if (job.name === 'check-expired-transactions') {
        await schedulerQueue.removeRepeatableByKey(job.key)
      }
    }

    // Add new repeatable job - runs every minute
    await schedulerQueue.add(
      'check-expired-transactions',
      {},
      {
        repeat: {
          pattern: '* * * * *', // Every minute
        },
      },
    )

    log.info('Scheduled expiry check job to run every minute')
  } catch (error) {
    // Handle READONLY errors - indicates Redis role change (master -> replica)
    if (
      error instanceof Error &&
      (error.message.includes('READONLY') ||
        error.message.includes('UNBLOCKED'))
    ) {
      log.warn(
        `Redis role change detected (master -> replica): ${error.message}`,
      )
      reconnectRedis()
      // Retry scheduling after reconnect
      return scheduleExpiryCheck()
    }
    log.error(`Error scheduling expiry check: ${error}`)
    throw error
  }
}

/**
 * Worker to process scheduled tasks
 */
export function startSchedulerWorker() {
  const worker = new Worker(
    'scheduler',
    async (job) => {
      if (job.name === 'check-expired-transactions') {
        log.info('Running scheduled expiry check...')
        const [expiredResult, inventoryResult] = await Promise.all([
          checkExpiredTransactions(),
          restoreCompletedInventorySessions(),
        ])
        log.info(
          `Scheduler check completed: ${expiredResult.expiredPayments} payments, ${expiredResult.expiredHoldBookings} hold bookings expired, ${inventoryResult.restoredInventoryBookings} inventory sessions restored`,
        )
        return {
          ...expiredResult,
          ...inventoryResult,
        }
      }
    },
    {
      connection: redisConnection,
      concurrency: 1, // Process one at a time to avoid race conditions
      lockDuration: 30000, // 30 seconds lock
      lockRenewTime: 15000, // Renew every 15 seconds
    },
  )

  worker.on('completed', (job) => {
    log.info(`Scheduler job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    log.error(`Scheduler job ${job?.id} failed: ${err.message}`)

    // Handle READONLY errors - indicates Redis role change (master -> replica)
    if (err.message.includes('READONLY') || err.message.includes('UNBLOCKED')) {
      log.warn(`Redis role change detected: ${err.message}`)
      log.info('Will attempt to reconnect on next job run')
    }
  })

  worker.on('error', (err) => {
    log.error(`Scheduler worker error: ${err.message}`)

    // Handle READONLY errors - indicates Redis role change (master -> replica)
    if (err.message.includes('READONLY') || err.message.includes('UNBLOCKED')) {
      log.warn(
        `Redis role change detected (master -> replica), attempting reconnect: ${err.message}`,
      )
      try {
        reconnectRedis()
      } catch (reconnectError) {
        log.error(`Failed to reconnect after role change: ${reconnectError}`)
      }
    }
  })

  worker.on('closed', () => {
    log.warn('Scheduler worker closed')
  })

  worker.on('stalled', (jobId) => {
    log.warn(`Scheduler job ${jobId} stalled - may be due to Redis role change`)
  })

  log.info('Scheduler worker started')

  return worker
}
