import type { Prisma } from '@prisma/client'
import { BadRequestException } from '@/exceptions'
import { generateInvoiceNumber } from '@/lib/utils'
import type { RescheduleCharge } from '@/lib/reschedule-charge'

/** Record a new receipt; never change the amount or payment date of the original invoice. */
export async function recordRescheduleCharge(
  tx: Prisma.TransactionClient,
  charge: RescheduleCharge,
  input: {
    branchId: string
    userId: string | null
    actorId: string
    paymentMethodId?: string
  },
) {
  const total =
    charge.courtAmount +
    charge.services.reduce((sum, line) => sum + line.amount, 0)
  if (!total) return null
  if (!input.userId || !input.paymentMethodId)
    throw new BadRequestException(
      'Pilih metode pembayaran untuk menerima selisih reschedule.',
    )
  await tx.$queryRaw`SELECT id FROM payment_methods WHERE id = ${input.paymentMethodId} FOR SHARE`
  const method = await tx.paymentMethod.findFirst({
    where: {
      id: input.paymentMethodId,
      isActive: true,
      OR: [
        { isOffline: true },
        {
          channel: {
            in: ['CASH', 'EDC', 'QRIS_STATIC', 'BANK_TRANSFER_MANUAL'],
          },
        },
      ],
    },
  })
  if (
    !method ||
    !method.isActive ||
    !(
      method.isOffline ||
      ['CASH', 'EDC', 'QRIS_STATIC', 'BANK_TRANSFER_MANUAL'].includes(
        method.channel ?? '',
      )
    )
  )
    throw new BadRequestException(
      'Metode pembayaran selisih harus aktif dan offline.',
    )
  const now = new Date()
  const booking = await tx.booking.create({
    data: {
      branchId: input.branchId,
      userId: input.userId,
      cashierId: input.actorId,
      serviceForBookingId: charge.courtBookingId,
      status: 'CONFIRMED',
      totalPrice: total,
      courtNormalPrice: charge.courtAmount,
      courtDiscountPrice: charge.courtAmount,
      adminNote: 'Tambahan biaya reschedule lapangan dan layanan.',
    },
  })
  const payment = await tx.payment.create({
    data: {
      paymentMethodId: method.id,
      status: 'PAID',
      amount: total,
      fees: 0,
      paidAt: now,
      meta: { ...charge, receivedBy: input.actorId, methodName: method.name },
    },
  })
  return tx.invoice.create({
    data: {
      branchId: input.branchId,
      bookingId: booking.id,
      userId: input.userId,
      number: await generateInvoiceNumber(),
      paymentId: payment.id,
      subtotal: total,
      total,
      processingFee: 0,
      status: 'PAID',
      paidAt: now,
      issuedAt: now,
      dueDate: now,
    },
  })
}
