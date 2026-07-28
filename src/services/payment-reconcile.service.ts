import {
  BookingStatus,
  PaymentStatus,
  SlotType,
  type Prisma,
} from '@prisma/client'
import { log } from '@/lib/logger'
import { activateMembershipAfterPayment } from '@/services/membership-activation.service'
import { xenditService } from '@/services/xendit.service'

type Tx = Prisma.TransactionClient

const UNPAID_OR_TERMINAL_UNPAID: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.AWAITING_CONFIRMATION,
  PaymentStatus.EXPIRED,
  PaymentStatus.CANCELLED,
]

const GATEWAY_PAID_STATUSES = new Set([
  'SUCCEEDED',
  'COMPLETED',
  'PAID',
  'SUCCESS',
])

export type FinalizePaymentResult =
  | { outcome: 'already_paid' }
  | { outcome: 'confirmed'; revived: boolean }
  | { outcome: 'paid_needs_manual_review'; reason: string }

export type TerminalFailureResult =
  | { applied: true }
  | { applied: false; reason: string }

type PaymentMeta = Record<string, unknown> | null | undefined

function asMeta(meta: unknown): Record<string, unknown> {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return { ...(meta as Record<string, unknown>) }
  }
  return {}
}

/**
 * Atomically claim available slots. Returns false when any slot is taken.
 */
async function tryClaimSlots(
  tx: Tx,
  slotIds: string[],
  type: SlotType,
): Promise<boolean> {
  const uniqueSlotIds = Array.from(new Set(slotIds.filter(Boolean)))
  if (uniqueSlotIds.length === 0) {
    return true
  }

  const claimed = await tx.slot.updateMany({
    where: {
      id: { in: uniqueSlotIds },
      type,
      isAvailable: true,
    },
    data: { isAvailable: false },
  })

  return claimed.count === uniqueSlotIds.length
}

async function reapplyInventoryForRevivedBooking(
  tx: Tx,
  bookingId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const returnedInventories = await tx.bookingInventory.findMany({
    where: {
      bookingId,
      returnedAt: { not: null },
    },
  })

  for (const bookingInv of returnedInventories) {
    const inventory = await tx.inventory.findUnique({
      where: { id: bookingInv.inventoryId },
      select: { id: true, quantity: true },
    })

    if (!inventory || inventory.quantity < bookingInv.quantity) {
      return {
        ok: false,
        reason: `Insufficient inventory ${bookingInv.inventoryId} to revive booking`,
      }
    }

    const claimed = await tx.bookingInventory.updateMany({
      where: {
        id: bookingInv.id,
        returnedAt: { not: null },
      },
      data: { returnedAt: null },
    })

    if (claimed.count === 0) {
      continue
    }

    await tx.inventory.update({
      where: { id: bookingInv.inventoryId },
      data: { quantity: { decrement: bookingInv.quantity } },
    })
  }

  return { ok: true }
}

async function reapplyMembershipSessionsForRevivedBooking(
  tx: Tx,
  booking: {
    membershipUserId: string | null
    membershipSessionsUsed: number
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!booking.membershipUserId || !booking.membershipSessionsUsed) {
    return { ok: true }
  }

  const sessions = Math.max(0, Math.trunc(booking.membershipSessionsUsed))
  if (sessions === 0) {
    return { ok: true }
  }

  const membershipUser = await tx.membershipUser.findUnique({
    where: { id: booking.membershipUserId },
    select: { id: true, remainingSessions: true },
  })

  if (!membershipUser) {
    return {
      ok: false,
      reason: 'Membership user missing; cannot re-deduct sessions',
    }
  }

  if (membershipUser.remainingSessions < sessions) {
    return {
      ok: false,
      reason: 'Insufficient membership sessions to revive booking',
    }
  }

  await tx.membershipUser.update({
    where: { id: membershipUser.id },
    data: {
      remainingSessions: membershipUser.remainingSessions - sessions,
    },
  })

  return { ok: true }
}

/**
 * Revive a booking that was cancelled by local payment expiry after money
 * actually arrived at Xendit. Re-claims slots and re-applies inventory /
 * membership usage. Returns false when resources are no longer available.
 */
async function reviveCancelledBookingAfterLatePayment(
  tx: Tx,
  bookingId: string,
  now: Date,
): Promise<{ revived: true } | { revived: false; reason: string }> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      membershipUserId: true,
      membershipSessionsUsed: true,
      cancellationReason: true,
    },
  })

  if (!booking) {
    return { revived: false, reason: 'Booking not found' }
  }

  if (booking.status === BookingStatus.CONFIRMED) {
    return { revived: true }
  }

  if (booking.status !== BookingStatus.CANCELLED) {
    return {
      revived: false,
      reason: `Cannot revive booking in status ${booking.status}`,
    }
  }

  const [details, coaches, ballboys] = await Promise.all([
    tx.bookingDetail.findMany({
      where: { bookingId },
      select: { slotId: true },
    }),
    tx.bookingCoach.findMany({
      where: { bookingId },
      select: { slotId: true },
    }),
    tx.bookingBallboy.findMany({
      where: { bookingId },
      select: { slotId: true },
    }),
  ])

  const courtSlotIds = details.map((d) => d.slotId)
  const coachSlotIds = coaches.map((c) => c.slotId)
  const ballboySlotIds = ballboys.map((b) => b.slotId)

  if (!(await tryClaimSlots(tx, courtSlotIds, SlotType.COURT))) {
    return { revived: false, reason: 'Court slots no longer available' }
  }
  if (!(await tryClaimSlots(tx, coachSlotIds, SlotType.COACH))) {
    // Roll back court claims from this attempt
    if (courtSlotIds.length > 0) {
      await tx.slot.updateMany({
        where: { id: { in: courtSlotIds } },
        data: { isAvailable: true },
      })
    }
    return { revived: false, reason: 'Coach slots no longer available' }
  }
  if (!(await tryClaimSlots(tx, ballboySlotIds, SlotType.BALLBOY))) {
    if (courtSlotIds.length > 0) {
      await tx.slot.updateMany({
        where: { id: { in: courtSlotIds } },
        data: { isAvailable: true },
      })
    }
    if (coachSlotIds.length > 0) {
      await tx.slot.updateMany({
        where: { id: { in: coachSlotIds } },
        data: { isAvailable: true },
      })
    }
    return { revived: false, reason: 'Ballboy slots no longer available' }
  }

  const inventoryResult = await reapplyInventoryForRevivedBooking(tx, bookingId)
  if (!inventoryResult.ok) {
    await tx.slot.updateMany({
      where: {
        id: { in: [...courtSlotIds, ...coachSlotIds, ...ballboySlotIds] },
      },
      data: { isAvailable: true },
    })
    return { revived: false, reason: inventoryResult.reason }
  }

  const membershipResult = await reapplyMembershipSessionsForRevivedBooking(
    tx,
    booking,
  )
  if (!membershipResult.ok) {
    await tx.slot.updateMany({
      where: {
        id: { in: [...courtSlotIds, ...coachSlotIds, ...ballboySlotIds] },
      },
      data: { isAvailable: true },
    })
    return { revived: false, reason: membershipResult.reason }
  }

  await tx.bookingCoach.updateMany({
    where: { bookingId },
    data: {
      status: BookingStatus.CONFIRMED,
      cancelledAt: null,
      cancellationReason: null,
    },
  })

  await tx.bookingBallboy.updateMany({
    where: { bookingId },
    data: {
      status: BookingStatus.CONFIRMED,
      cancelledAt: null,
      cancellationReason: null,
    },
  })

  const previousReason = booking.cancellationReason || 'Payment expired'
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      status: BookingStatus.CONFIRMED,
      cancelledAt: null,
      cancellationReason: null,
      holdExpiresAt: null,
      adminNote: `Late payment reconciled at ${now.toISOString()}. Previously cancelled: ${previousReason}`,
    },
  })

  log.info(`Revived cancelled booking ${bookingId} after late payment`)
  return { revived: true }
}

async function reviveCancelledClassBookingAfterLatePayment(
  tx: Tx,
  classBookingId: string,
  now: Date,
): Promise<{ revived: true } | { revived: false; reason: string }> {
  const classBooking = await tx.classBooking.findUnique({
    where: { id: classBookingId },
    select: {
      id: true,
      status: true,
      classId: true,
      cancellationReason: true,
    },
  })

  if (!classBooking) {
    return { revived: false, reason: 'Class booking not found' }
  }

  if (classBooking.status === BookingStatus.CONFIRMED) {
    return { revived: true }
  }

  if (classBooking.status !== BookingStatus.CANCELLED) {
    return {
      revived: false,
      reason: `Cannot revive class booking in status ${classBooking.status}`,
    }
  }

  const classRow = await tx.class.findUnique({
    where: { id: classBooking.classId },
    select: { id: true, remaining: true },
  })

  if (!classRow || classRow.remaining <= 0) {
    return { revived: false, reason: 'Class has no remaining capacity' }
  }

  const claimed = await tx.class.updateMany({
    where: {
      id: classRow.id,
      remaining: { gt: 0 },
    },
    data: { remaining: { decrement: 1 } },
  })

  if (claimed.count === 0) {
    return { revived: false, reason: 'Class has no remaining capacity' }
  }

  await tx.classBooking.update({
    where: { id: classBookingId },
    data: {
      status: BookingStatus.CONFIRMED,
      cancelledAt: null,
      cancellationReason: null,
    },
  })

  log.info(
    `Revived cancelled class booking ${classBookingId} after late payment at ${now.toISOString()}`,
  )
  return { revived: true }
}

/**
 * Mark invoice/payment PAID and confirm related bookings.
 * Handles the late-capture case where local status was already EXPIRED/CANCELLED.
 */
export async function finalizeSuccessfulPayment(
  tx: Tx,
  {
    invoiceId,
    paidAt = new Date(),
    externalRef,
    metaPatch,
  }: {
    invoiceId: string
    paidAt?: Date
    externalRef?: string | null
    metaPatch?: PaymentMeta
  },
): Promise<FinalizePaymentResult> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payment: true,
      booking: true,
      classBooking: true,
      membershipUser: true,
    },
  })

  if (!invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`)
  }

  if (invoice.status === PaymentStatus.PAID) {
    return { outcome: 'already_paid' }
  }

  if (invoice.status === PaymentStatus.REFUNDED) {
    return {
      outcome: 'paid_needs_manual_review',
      reason: 'Invoice already refunded; gateway paid event ignored for confirm',
    }
  }

  const previousStatus = invoice.status

  const claimedInvoice = await tx.invoice.updateMany({
    where: {
      id: invoice.id,
      status: { in: UNPAID_OR_TERMINAL_UNPAID },
    },
    data: {
      status: PaymentStatus.PAID,
      paidAt,
      cancelledAt: null,
    },
  })

  if (claimedInvoice.count === 0) {
    const current = await tx.invoice.findUnique({
      where: { id: invoice.id },
      select: { status: true },
    })
    if (current?.status === PaymentStatus.PAID) {
      return { outcome: 'already_paid' }
    }
    return {
      outcome: 'paid_needs_manual_review',
      reason: `Invoice status ${current?.status} cannot be marked PAID`,
    }
  }

  if (invoice.payment) {
    const nextMeta = {
      ...asMeta(invoice.payment.meta),
      ...asMeta(metaPatch),
      reconciled_at: paidAt.toISOString(),
    }

    await tx.payment.updateMany({
      where: {
        id: invoice.payment.id,
        status: { in: UNPAID_OR_TERMINAL_UNPAID },
      },
      data: {
        status: PaymentStatus.PAID,
        paidAt,
        cancelledAt: null,
        ...(externalRef ? { externalRef } : {}),
        meta: nextMeta,
      },
    })
  }

  let revived = false
  const reviewReasons: string[] = []

  if (invoice.bookingId && invoice.booking) {
    if (invoice.booking.status === BookingStatus.HOLD) {
      await tx.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: BookingStatus.CONFIRMED,
          holdExpiresAt: null,
          cancelledAt: null,
          cancellationReason: null,
        },
      })
    } else if (invoice.booking.status === BookingStatus.CANCELLED) {
      const result = await reviveCancelledBookingAfterLatePayment(
        tx,
        invoice.bookingId,
        paidAt,
      )
      if (result.revived) {
        revived = true
      } else {
        reviewReasons.push(result.reason)
        await tx.booking.update({
          where: { id: invoice.bookingId },
          data: {
            adminNote: `LATE_PAYMENT_NEEDS_REVIEW (${paidAt.toISOString()}): ${result.reason}. Payment is PAID at gateway; booking remains CANCELLED — refund or rebook.`,
          },
        })
        if (invoice.payment) {
          await tx.payment.update({
            where: { id: invoice.payment.id },
            data: {
              meta: {
                ...asMeta(invoice.payment.meta),
                ...asMeta(metaPatch),
                reconcile_status: 'NEEDS_MANUAL_REVIEW',
                reconcile_reason: result.reason,
                reconciled_at: paidAt.toISOString(),
              },
            },
          })
        }
      }
    } else if (invoice.booking.status === BookingStatus.CONFIRMED) {
      // Already confirmed — nothing to do
    }
  }

  if (invoice.classBookingId && invoice.classBooking) {
    if (invoice.classBooking.status === BookingStatus.HOLD) {
      await tx.classBooking.update({
        where: { id: invoice.classBookingId },
        data: {
          status: BookingStatus.CONFIRMED,
          cancelledAt: null,
          cancellationReason: null,
        },
      })
    } else if (invoice.classBooking.status === BookingStatus.CANCELLED) {
      const result = await reviveCancelledClassBookingAfterLatePayment(
        tx,
        invoice.classBookingId,
        paidAt,
      )
      if (result.revived) {
        revived = true
      } else {
        reviewReasons.push(result.reason)
        if (invoice.payment) {
          await tx.payment.update({
            where: { id: invoice.payment.id },
            data: {
              meta: {
                ...asMeta(invoice.payment.meta),
                ...asMeta(metaPatch),
                reconcile_status: 'NEEDS_MANUAL_REVIEW',
                reconcile_reason: result.reason,
                reconciled_at: paidAt.toISOString(),
              },
            },
          })
        }
      }
    }
  }

  if (invoice.membershipUserId) {
    const activated = await activateMembershipAfterPayment(
      tx,
      invoice.membershipUserId,
      paidAt,
    )
    if (!activated) {
      reviewReasons.push('Membership purchase row missing after expire discard')
    }
  } else if (
    !invoice.bookingId &&
    !invoice.classBookingId &&
    (previousStatus === PaymentStatus.EXPIRED ||
      previousStatus === PaymentStatus.CANCELLED)
  ) {
    // Membership-only invoices null out membershipUserId when discardUnpaidMembership runs
    reviewReasons.push(
      'Membership purchase was discarded on expire; recreate membership manually',
    )
  }

  if (reviewReasons.length > 0) {
    log.warn(
      `Payment finalized with manual review for invoice ${invoice.number}: ${reviewReasons.join('; ')}`,
    )
    return {
      outcome: 'paid_needs_manual_review',
      reason: reviewReasons.join('; '),
    }
  }

  log.info(
    `Payment finalized for invoice ${invoice.number}${revived ? ' (revived after expire)' : ''}`,
  )
  return { outcome: 'confirmed', revived }
}

/**
 * Apply EXPIRED/CANCELLED only when the invoice is not already PAID.
 * Never downgrades a successful payment.
 */
export async function applyPaymentTerminalFailure(
  tx: Tx,
  {
    invoiceId,
    status,
    reason,
    metaPatch,
    now = new Date(),
  }: {
    invoiceId: string
    status: typeof PaymentStatus.EXPIRED | typeof PaymentStatus.CANCELLED
    reason: string
    metaPatch?: PaymentMeta
    now?: Date
  },
): Promise<TerminalFailureResult> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { payment: true },
  })

  if (!invoice) {
    return { applied: false, reason: 'Invoice not found' }
  }

  if (invoice.status === PaymentStatus.PAID) {
    log.info(
      `Skipping ${status} for invoice ${invoice.number}: already PAID (${reason})`,
    )
    return { applied: false, reason: 'already_paid' }
  }

  if (
    invoice.status === PaymentStatus.EXPIRED ||
    invoice.status === PaymentStatus.CANCELLED
  ) {
    return { applied: false, reason: 'already_terminal' }
  }

  const claimed = await tx.invoice.updateMany({
    where: {
      id: invoice.id,
      status: {
        in: [PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION],
      },
    },
    data: {
      status,
      cancelledAt: status === PaymentStatus.CANCELLED ? now : undefined,
    },
  })

  if (claimed.count === 0) {
    return { applied: false, reason: 'status_race' }
  }

  if (invoice.payment) {
    await tx.payment.updateMany({
      where: {
        id: invoice.payment.id,
        status: {
          in: [PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION],
        },
      },
      data: {
        status,
        cancelledAt: status === PaymentStatus.CANCELLED ? now : undefined,
        meta: {
          ...asMeta(invoice.payment.meta),
          ...asMeta(metaPatch),
          terminal_reason: reason,
          terminal_at: now.toISOString(),
        },
      },
    })
  }

  return { applied: true }
}

/**
 * Resolve Xendit payment-request id from payment.externalRef / meta.
 */
export function extractGatewayPaymentRequestId(payment: {
  externalRef: string | null
  meta: unknown
}): string | null {
  const meta = asMeta(payment.meta)
  const fromMeta = meta.payment_request_id
  if (typeof fromMeta === 'string' && fromMeta.length > 0) {
    return fromMeta
  }

  const ref = payment.externalRef
  if (!ref) {
    return null
  }

  // Payment sessions use ps-*; payment requests use pr-* (or bare ids)
  if (ref.startsWith('ps-')) {
    return null
  }

  return ref
}

/**
 * Returns true when Xendit already shows the payment as completed.
 * Used by the scheduler to avoid expiring a payment that settled late.
 */
export async function isGatewayPaymentCompleted(payment: {
  externalRef: string | null
  meta: unknown
}): Promise<boolean> {
  const paymentRequestId = extractGatewayPaymentRequestId(payment)
  if (!paymentRequestId) {
    return false
  }

  try {
    const remote = await xenditService.getPaymentRequestV3(paymentRequestId)
    if (!remote?.status) {
      return false
    }

    const paid = GATEWAY_PAID_STATUSES.has(String(remote.status).toUpperCase())
    if (paid) {
      log.info(
        `Gateway payment request ${paymentRequestId} is already ${remote.status}`,
      )
    }
    return paid
  } catch (error) {
    log.warn(
      `Failed checking gateway status for ${paymentRequestId}: ${error}`,
    )
    return false
  }
}
