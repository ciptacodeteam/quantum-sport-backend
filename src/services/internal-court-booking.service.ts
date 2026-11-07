import { z } from 'zod'
import { db } from '@/lib/prisma'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { bookableCourtWhere } from '@/lib/court-branch-policy'
import { courtBookingCutoff } from '@/lib/booking-time-policy'
import { formatPhone } from '@/lib/utils'
import { claimSlotsAtomically } from './slot-claim.service'

export const MAX_INTERNAL_COURT_BOOKING_SLOTS = 1000

export const internalCourtBookingSchema = z
  .object({
    purpose: z.enum(['COACH_TRAINING', 'EVENT']),
    activityName: z.string().trim().min(1).max(200),
    courtSlots: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_INTERNAL_COURT_BOOKING_SLOTS, {
        error: 'Maksimal 1.000 slot lapangan dalam satu pemesanan.',
      }),
    userId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(5).max(30).optional(),
    adminNote: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (input) =>
      !!input.userId ||
      (!input.name && !input.phone) ||
      (!!input.name && !!input.phone),
    {
      message: 'Jika mengisi walk-in, lengkapi nama dan nomor telepon.',
      path: ['userId'],
    },
  )

export async function createInternalCourtBooking(
  input: z.infer<typeof internalCourtBookingSchema>,
  cashierId: string,
) {
  const slotIds = [...new Set(input.courtSlots)]
  const now = new Date()
  const cutoff = courtBookingCutoff(now)
  return db.$transaction(async (tx) => {
    const slots = await tx.slot.findMany({
      where: {
        id: { in: slotIds },
        type: 'COURT',
        isAvailable: true,
        court: { is: bookableCourtWhere },
      },
    })
    if (slots.length !== slotIds.length)
      throw new BadRequestException(
        'Slot lapangan tidak ditemukan atau sudah tidak tersedia.',
      )
    if (slots.some((slot) => slot.startAt <= cutoff))
      throw new BadRequestException(
        'Slot telah melewati batas pemesanan 15 menit.',
      )

    // Same atomic claim as regular checkout: branch, schedule, public horizon,
    // and concurrent booking checks all apply. Any later failure rolls this back.
    await claimSlotsAtomically(tx, {
      slotIds,
      type: 'COURT',
      startsAfter: cutoff,
      windowAt: now,
      unavailableMessage:
        'Slot lapangan sudah tidak tersedia. Silakan pilih ulang.',
    })

    let userId = input.userId ?? null
    if (userId) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      })
      if (!user) throw new NotFoundException('Pelanggan tidak ditemukan.')
    } else if (input.name && input.phone) {
      const phone = await formatPhone(input.phone!)
      const existing = await tx.user.findUnique({
        where: { phone },
        select: { id: true },
      })
      const user =
        existing ??
        (await tx.user.create({
          data: { name: input.name!, phone, source: 'WALK_IN', password: null },
          select: { id: true },
        }))
      userId = user.id
    }

    // No invoice, payment, fees, discount or membership debit is created.
    // Both booking and detail prices are zero, including in court reports.
    return tx.booking.create({
      data: {
        userId,
        cashierId,
        purpose: input.purpose,
        activityName: input.activityName,
        adminNote: input.adminNote || null,
        status: 'CONFIRMED',
        totalPrice: 0,
        processingFee: 0,
        courtNormalPrice: 0,
        courtDiscountPrice: 0,
        details: {
          create: slots.map((slot) => ({
            slotId: slot.id,
            courtId: slot.courtId,
            price: 0,
            discountPrice: 0,
          })),
        },
      },
      include: { details: true },
    })
  })
}
