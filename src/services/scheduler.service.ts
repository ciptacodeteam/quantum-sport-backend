import { Queue, Worker } from 'bullmq'
import { db } from '@/lib/prisma'
import { BookingStatus, PaymentStatus } from '@prisma/client'
import { log } from '@/lib/logger'
import { getRedisConnection } from '@/lib/redis'

let redisConnection = getRedisConnection()

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

/**
 * Check for expired payments and update their status
 * This runs every minute to check for:
 * - Invoices past their dueDate with PENDING status
 * - Payments past their dueDate with PENDING status
 * - Bookings past their holdExpiresAt with HOLD status
 */
export async function checkExpiredTransactions() {
  const now = new Date()

  try {
    // Find expired payments
    const expiredPayments = await db.payment.findMany({
      where: {
        status: {
          in: [
            PaymentStatus.PENDING,
            PaymentStatus.CANCELLED,
            PaymentStatus.EXPIRED,
          ],
        },
        dueDate: {
          lte: now,
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

    // Update expired payments and related records
    for (const payment of expiredPayments) {
      await db.$transaction(async (tx) => {
        // First, release slots if booking exists
        if (payment.invoice?.booking) {
          // Collect all slot IDs
          const bookingDetails = await tx.bookingDetail.findMany({
            where: { bookingId: payment.invoice.booking.id },
            select: { slotId: true },
          })
          const courtSlotIds = bookingDetails.map((bd) => bd.slotId)

          const coachDetails = await tx.bookingCoach.findMany({
            where: { bookingId: payment.invoice.booking.id },
            select: { slotId: true },
          })
          const coachSlotIds = coachDetails.map((bc) => bc.slotId)

          const ballboyDetails = await tx.bookingBallboy.findMany({
            where: { bookingId: payment.invoice.booking.id },
            select: { slotId: true },
          })
          const ballboySlotIds = ballboyDetails.map((bb) => bb.slotId)

          const allSlotIds = [
            ...courtSlotIds,
            ...coachSlotIds,
            ...ballboySlotIds,
          ]

          // Release slots immediately BEFORE updating statuses
          if (allSlotIds.length > 0) {
            await tx.slot.updateMany({
              where: { id: { in: allSlotIds } },
              data: { isAvailable: true },
            })
            log.info(
              `Released ${allSlotIds.length} slots for booking ${payment.invoice.booking.id}`,
            )
          }

          await tx.bookingBallboy.updateMany({
            where: {
              bookingId: payment.invoice.booking.id,
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: 'Payment expired',
              cancelledAt: now,
            },
          })

          await tx.bookingCoach.updateMany({
            where: {
              bookingId: payment.invoice.booking.id,
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: 'Payment expired',
              cancelledAt: now,
            },
          })
        }

        // Update payment status to EXPIRED
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.EXPIRED,
          },
        })

        // Update invoice status to EXPIRED
        if (payment.invoice) {
          await tx.invoice.update({
            where: { id: payment.invoice.id },
            data: {
              status: PaymentStatus.EXPIRED,
            },
          })

          // Update booking status to CANCELLED if exists and restore inventory
          if (payment.invoice.booking) {
            // Restore inventory quantities (they were decremented during checkout)
            const bookingInventories = await tx.bookingInventory.findMany({
              where: {
                bookingId: payment.invoice.booking.id,
                returnedAt: null,
              },
            })
            for (const bookingInv of bookingInventories) {
              await tx.inventory.update({
                where: { id: bookingInv.inventoryId },
                data: {
                  quantity: { increment: bookingInv.quantity },
                },
              })
              await tx.bookingInventory.update({
                where: { id: bookingInv.id },
                data: { returnedAt: now },
              })
              log.info(
                `Restored inventory ${bookingInv.inventoryId} by ${bookingInv.quantity} for expired payment ${payment.id}`,
              )
            }

            await tx.booking.update({
              where: { id: payment.invoice.booking.id },
              data: {
                status: BookingStatus.CANCELLED,
                cancellationReason: 'Payment expired',
                cancelledAt: now,
              },
            })
          }

          // Update class booking status to CANCELLED if exists
          if (payment.invoice.classBooking) {
            await tx.classBooking.update({
              where: { id: payment.invoice.classBooking.id },
              data: {
                status: BookingStatus.CANCELLED,
                cancellationReason: 'Payment expired',
                cancelledAt: now,
              },
            })

            // Restore class capacity
            const classBooking = payment.invoice.classBooking
            await tx.class.update({
              where: { id: classBooking.classId },
              data: {
                remaining: {
                  increment: 1,
                },
              },
            })
          }

          // Delete membership user if payment expired (not yet activated)
          if (payment.invoice.membershipUser) {
            await tx.membershipUser.delete({
              where: { id: payment.invoice.membershipUser.id },
            })
            log.info(
              `Deleted unpaid membership ${payment.invoice.membershipUser.id}`,
            )
          }
        }

        log.info(`Expired payment ${payment.id} and related records`)
      })
    }

    // Also check for bookings with expired holdExpiresAt (backup check)
    const expiredHoldBookings = await db.booking.findMany({
      where: {
        status: BookingStatus.HOLD,
        holdExpiresAt: {
          lte: now,
        },
      },
    })

    log.info(
      `Found ${expiredHoldBookings.length} expired hold bookings to process`,
    )

    for (const booking of expiredHoldBookings) {
      await db.$transaction(async (tx) => {
        // First, collect and release slots
        const bookingDetails = await tx.bookingDetail.findMany({
          where: { bookingId: booking.id },
          select: { slotId: true },
        })
        const courtSlotIds = bookingDetails.map((bd) => bd.slotId)

        const coachDetails = await tx.bookingCoach.findMany({
          where: { bookingId: booking.id },
          select: { slotId: true },
        })
        const coachSlotIds = coachDetails.map((bc) => bc.slotId)

        const ballboyDetails = await tx.bookingBallboy.findMany({
          where: { bookingId: booking.id },
          select: { slotId: true },
        })
        const ballboySlotIds = ballboyDetails.map((bb) => bb.slotId)

        const allSlotIds = [...courtSlotIds, ...coachSlotIds, ...ballboySlotIds]

        // Release slots immediately BEFORE updating statuses
        if (allSlotIds.length > 0) {
          await tx.slot.updateMany({
            where: { id: { in: allSlotIds } },
            data: { isAvailable: true },
          })
          log.info(
            `Released ${allSlotIds.length} slots for expired hold booking ${booking.id}`,
          )
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
            cancellationReason: 'Hold period expired',
            cancelledAt: now,
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
            cancellationReason: 'Hold period expired',
            cancelledAt: now,
          },
        })

        // Restore inventory quantities (they were decremented during checkout)
        const bookingInventories = await tx.bookingInventory.findMany({
          where: { bookingId: booking.id, returnedAt: null },
        })
        for (const bookingInv of bookingInventories) {
          await tx.inventory.update({
            where: { id: bookingInv.inventoryId },
            data: {
              quantity: { increment: bookingInv.quantity },
            },
          })
          await tx.bookingInventory.update({
            where: { id: bookingInv.id },
            data: { returnedAt: now },
          })
          log.info(
            `Restored inventory ${bookingInv.inventoryId} by ${bookingInv.quantity} for expired hold booking ${booking.id}`,
          )
        }

        // Update booking status to CANCELLED
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: 'Hold period expired',
            cancelledAt: now,
          },
        })

        // Update related invoice status if exists
        const invoice = await tx.invoice.findFirst({
          where: { bookingId: booking.id },
        })
        if (invoice && invoice.status === PaymentStatus.PENDING) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: PaymentStatus.EXPIRED },
          })
        }
      })
    }

    return {
      expiredPayments: expiredPayments.length,
      expiredHoldBookings: expiredHoldBookings.length,
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
