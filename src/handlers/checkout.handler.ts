import { getTariffPeriods } from '@/services/tariff-policy.service'
import { rollingBookingWindowWhere } from '@/lib/rolling-booking-window'
import {
  courtBookingCutoff,
  paymentDeadline,
  PAYMENT_WINDOW_MINUTES,
} from '@/lib/booking-time-policy'
import { bookableCourtWhere } from '@/lib/court-branch-policy'
import { assertClientCheckoutHasNoAddOns } from '@/lib/client-checkout-policy'
import { consumeMembershipHours } from '@/services/membership-checkout.service'
import { env } from '@/env'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { isSlotAllowedForMembershipType } from '@/lib/membership-hours'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { generateInvoiceNumber } from '@/lib/utils'
import {
  applyPromoCodeSchema,
  ApplyPromoCodeSchema,
  extendedCheckoutSchema,
} from '@/lib/validation'
import { requireAuth } from '@/middlewares/auth'
import { notificationService } from '@/services/notification.service'
import { assertCoachSlotsDoNotConflict } from '@/services/coach-booking-conflict.service'
import { getCourtCoachBundleDiscountByCourtSlot } from '@/services/booking-bundle-discount.service'
import { getInventoryAvailabilityMap } from '@/services/inventory-availability.service'
import { calculateMembershipSessionsForCourtSlots } from '@/services/membership-booking.service'
import {
  claimSlotsAtomically,
  releaseSlotsByIds,
} from '@/services/slot-claim.service'
import { midtransService } from '@/services/midtrans.service'
import { xenditService } from '@/services/xendit.service'
import { zValidator } from '@hono/zod-validator'
import {
  BookingStatus,
  CoachType,
  CourtSport,
  PaymentStatus,
  SlotType,
} from '@prisma/client'
import type { Membership, MembershipUser } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'

// const PROCESSING_FEE_PERCENT = 0.02 // 2% processing fee

/**
 * Cleans slot IDs by removing any time suffix pattern (e.g., "-06:00" or "-06:00:00")
 * This handles cases where the frontend accidentally appends time information to slot IDs
 */
function cleanSlotIds(slotIds: string[] | undefined): string[] | undefined {
  if (!slotIds || slotIds.length === 0) {
    return slotIds
  }
  // Remove time suffix patterns like "-06:00" or "-06:00:00" from slot IDs
  return Array.from(
    new Set(slotIds.map((id) => id.replace(/-\d{2}:\d{2}(:\d{2})?$/, ''))),
  )
}

type BallboySelectionInput = {
  slotId: string
  courtSlotId?: string
}

function normalizeBallboySelections(
  rawBallboySlots:
    | Array<string | { slotId: string; courtSlotId: string }>
    | undefined,
): BallboySelectionInput[] {
  if (!rawBallboySlots || rawBallboySlots.length === 0) {
    return []
  }

  const uniqueSelections = new Map<string, BallboySelectionInput>()

  for (const item of rawBallboySlots) {
    const slotId =
      typeof item === 'string'
        ? item.replace(/-\d{2}:\d{2}(:\d{2})?$/, '')
        : item.slotId.replace(/-\d{2}:\d{2}(:\d{2})?$/, '')
    const courtSlotId =
      typeof item === 'string'
        ? undefined
        : item.courtSlotId.replace(/-\d{2}:\d{2}(:\d{2})?$/, '')

    uniqueSelections.set(
      `${slotId}|${courtSlotId ?? ''}`,
      courtSlotId ? { slotId, courtSlotId } : { slotId },
    )
  }

  return Array.from(uniqueSelections.values())
}

function normalizePromoCode(code?: string): string | undefined {
  if (!code) {
    return undefined
  }
  return code.trim().toUpperCase()
}

function calculatePromoDiscount(
  subtotal: number,
  promo: { discountAmount: number | null; discountPercent: number | null },
): number {
  let discount = 0
  if (promo.discountAmount && promo.discountAmount > 0) {
    discount = promo.discountAmount
  } else if (promo.discountPercent && promo.discountPercent > 0) {
    discount = Math.ceil(subtotal * (promo.discountPercent / 100))
  }
  if (discount > subtotal) {
    return subtotal
  }
  return discount
}

function ballboyCoversCourtSlot(
  ballboySlot: { startAt: Date; endAt: Date },
  courtSlot: { startAt: Date; endAt: Date },
): boolean {
  return (
    dayjs(ballboySlot.startAt).valueOf() <=
      dayjs(courtSlot.startAt).valueOf() &&
    dayjs(ballboySlot.endAt).valueOf() >= dayjs(courtSlot.endAt).valueOf()
  )
}

function timeRangesOverlap(
  first: { startAt: Date; endAt: Date },
  second: { startAt: Date; endAt: Date },
): boolean {
  return (
    dayjs(first.startAt).valueOf() < dayjs(second.endAt).valueOf() &&
    dayjs(first.endAt).valueOf() > dayjs(second.startAt).valueOf()
  )
}

function validateBallboysForTennisCourts(
  ballboySelections: BallboySelectionInput[],
  ballboySlots: Array<{ id: string; startAt: Date; endAt: Date }>,
  courtSlots: Array<{
    id: string
    startAt: Date
    endAt: Date
    court?: { sport: CourtSport } | null
  }>,
) {
  if (ballboySlots.length === 0) {
    return
  }

  if (courtSlots.length === 0) {
    throw new BadRequestException(
      'Ballboy can only be added with tennis court bookings',
    )
  }

  if (courtSlots.some((slot) => slot.court?.sport !== CourtSport.TENNIS)) {
    throw new BadRequestException('Ballboy is only available for tennis courts')
  }

  const ballboyCountByCourtSlot = new Map<string, number>()
  const ballboySlotById = new Map(ballboySlots.map((slot) => [slot.id, slot]))
  const courtSlotById = new Map(courtSlots.map((slot) => [slot.id, slot]))

  for (const selection of ballboySelections) {
    const ballboySlot = ballboySlotById.get(selection.slotId)

    if (!ballboySlot) {
      throw new BadRequestException(
        'One or more ballboy slots not found or unavailable',
      )
    }

    let matchingCourtSlots: typeof courtSlots = []

    if (selection.courtSlotId) {
      const selectedCourtSlot = courtSlotById.get(selection.courtSlotId)

      if (!selectedCourtSlot) {
        throw new BadRequestException(
          'Ballboy selection must match a selected tennis court booking slot',
        )
      }

      if (!ballboyCoversCourtSlot(ballboySlot, selectedCourtSlot)) {
        throw new BadRequestException(
          'Ballboy slots must match selected tennis court booking times',
        )
      }

      matchingCourtSlots = [selectedCourtSlot]
    } else {
      matchingCourtSlots = courtSlots.filter((courtSlot) =>
        ballboyCoversCourtSlot(ballboySlot, courtSlot),
      )
    }

    if (matchingCourtSlots.length === 0) {
      throw new BadRequestException(
        'Ballboy slots must match selected tennis court booking times',
      )
    }

    if (!selection.courtSlotId && matchingCourtSlots.length > 1) {
      throw new BadRequestException(
        'Ballboy selection must be linked to a specific tennis court booking slot',
      )
    }

    for (const courtSlot of matchingCourtSlots) {
      ballboyCountByCourtSlot.set(
        courtSlot.id,
        (ballboyCountByCourtSlot.get(courtSlot.id) ?? 0) + 1,
      )
    }
  }

  for (const ballboyCount of ballboyCountByCourtSlot.values()) {
    if (ballboyCount > 1) {
      throw new BadRequestException(
        'Only one ballboy can be used per tennis court booking slot',
      )
    }
  }
}

/**
 * Handle credit card payment with Payment Sessions (Correct Flow)
 *
 * Flow:
 * 1. Backend creates payment session → returns payment_session_id
 * 2. Frontend uses payment_session_id with card_session.js to collect card data
 * 3. card_session.js automatically creates payment request → returns payment_request_id + action_url
 * 4. Frontend redirects user to action_url for 3DS authentication
 * 5. After 3DS, bank redirects to success/failure URL
 * 6. Backend receives webhook (payment.capture) for final confirmation
 *
 * Note: Backend does NOT handle card tokens or details anymore!
 * Card saving is handled via webhook after successful payment.
 */
export const applyPromoCodeHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', applyPromoCodeSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      const validated = c.req.valid('json') as ApplyPromoCodeSchema
      assertClientCheckoutHasNoAddOns(validated)
      const {
        promoCode: rawPromoCode,
        courtSlots: rawCourtSlots,
        coachSlots: rawCoachSlots,
        ballboySlots: rawBallboySlots,
        inventories,
      } = validated

      const promoCode = normalizePromoCode(rawPromoCode)
      const courtSlots = cleanSlotIds(rawCourtSlots)
      const coachSlots = cleanSlotIds(rawCoachSlots)
      const ballboySelections = normalizeBallboySelections(rawBallboySlots)
      const ballboySlots = Array.from(
        new Set(ballboySelections.map((selection) => selection.slotId)),
      )

      const hasItems =
        (courtSlots && courtSlots.length > 0) ||
        (coachSlots && coachSlots.length > 0) ||
        (ballboySlots && ballboySlots.length > 0) ||
        (inventories && inventories.length > 0)

      if (!hasItems) {
        return c.json(
          err('At least one item must be provided', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      if (!promoCode) {
        return c.json(
          ok({ isValid: false, discountAmount: 0 }, 'Promo code is required'),
          status.OK,
        )
      }

      const subtotal = await db.$transaction(async (tx) => {
        let totalPrice = 0
        let selectedCourtSlots: Array<{
          id: string
          startAt: Date
          endAt: Date
          price: number
          discountPrice: number
          court?: { sport: CourtSport } | null
        }> = []
        let selectedCoachSlots: Array<{
          startAt: Date
          endAt: Date
        }> = []

        if (courtSlots && courtSlots.length > 0) {
          const courtSlotData = await tx.slot.findMany({
            where: {
              id: { in: courtSlots },
              ...rollingBookingWindowWhere(),
              type: SlotType.COURT,
              isAvailable: true,
              court: { is: bookableCourtWhere },
            },
            include: {
              court: {
                select: {
                  sport: true,
                },
              },
              bookingDetails: {
                where: {
                  booking: {
                    status: {
                      not: BookingStatus.CANCELLED,
                    },
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })

          if (courtSlotData.length !== courtSlots.length) {
            throw new BadRequestException(
              'One or more court slots not found or unavailable',
            )
          }
          selectedCourtSlots = courtSlotData

          for (const slot of courtSlotData) {
            if (slot.bookingDetails.length > 0) {
              throw new BadRequestException(
                'One or more court slots are already booked',
              )
            }
            const discountedPrice =
              slot.discountPrice && slot.discountPrice > 0
                ? slot.discountPrice
                : slot.price
            totalPrice += discountedPrice
          }
        }

        if (coachSlots && coachSlots.length > 0) {
          const coachSlotData = await tx.slot.findMany({
            where: {
              id: { in: coachSlots },
              type: SlotType.COACH,
              isAvailable: true,
            },
            include: {
              bookingCoaches: {
                where: {
                  status: {
                    not: BookingStatus.CANCELLED,
                  },
                  booking: {
                    status: {
                      not: BookingStatus.CANCELLED,
                    },
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })

          if (coachSlotData.length !== coachSlots.length) {
            throw new BadRequestException(
              'One or more coach slots not found or unavailable',
            )
          }
          selectedCoachSlots = coachSlotData

          try {
            await assertCoachSlotsDoNotConflict(tx, coachSlotData)
          } catch (error) {
            throw new BadRequestException(
              error instanceof Error
                ? error.message
                : 'Coach schedule conflicts with another booking',
            )
          }

          for (const slot of coachSlotData) {
            if (slot.bookingCoaches.length > 0) {
              throw new BadRequestException(
                'One or more coach slots are already booked',
              )
            }
            totalPrice += slot.price
          }
        }

        if (selectedCourtSlots.length > 0 && selectedCoachSlots.length > 0) {
          const bundleDiscountByCourtSlot =
            getCourtCoachBundleDiscountByCourtSlot(
              selectedCourtSlots,
              selectedCoachSlots,
              await getTariffPeriods(),
            )

          for (const slot of selectedCourtSlots) {
            const rawDiscount = bundleDiscountByCourtSlot.get(slot.id) ?? 0
            if (rawDiscount <= 0) continue

            const paidCourtPrice =
              slot.discountPrice && slot.discountPrice > 0
                ? slot.discountPrice
                : slot.price
            totalPrice -= Math.min(rawDiscount, paidCourtPrice)
          }
        }

        if (ballboySlots && ballboySlots.length > 0) {
          const ballboySlotData = await tx.slot.findMany({
            where: {
              id: { in: ballboySlots },
              type: SlotType.BALLBOY,
              isAvailable: true,
            },
            include: {
              bookingBallboys: {
                where: {
                  status: {
                    not: BookingStatus.CANCELLED,
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })

          if (ballboySlotData.length !== ballboySlots.length) {
            throw new BadRequestException(
              'One or more ballboy slots not found or unavailable',
            )
          }

          validateBallboysForTennisCourts(
            ballboySelections,
            ballboySlotData,
            selectedCourtSlots,
          )

          for (const slot of ballboySlotData) {
            if (slot.bookingBallboys.length > 0) {
              throw new BadRequestException(
                'One or more ballboy slots are already booked',
              )
            }
            totalPrice += slot.price
          }
        }

        if (inventories && inventories.length > 0) {
          for (const inv of inventories) {
            const inventory = await tx.inventory.findUnique({
              where: { id: inv.inventoryId },
            })
            if (!inventory) {
              throw new NotFoundException(
                `Inventory ${inv.inventoryId} not found`,
              )
            }
            if (!inventory.isActive) {
              throw new BadRequestException(
                `Inventory ${inventory.name} is not active`,
              )
            }
            if (inventory.quantity < inv.quantity) {
              throw new BadRequestException(
                `Insufficient quantity for ${inventory.name}`,
              )
            }
            totalPrice += inventory.price * inv.quantity
          }
        }

        return totalPrice
      })

      const promo = await db.promoCode.findUnique({
        where: { code: promoCode },
      })

      if (!promo) {
        return c.json(
          ok({ isValid: false, discountAmount: 0 }, 'Promo code not found'),
          status.OK,
        )
      }

      const now = dayjs()
      if (promo.status !== 'ACTIVE') {
        return c.json(
          ok({ isValid: false, discountAmount: 0 }, 'Promo code is not active'),
          status.OK,
        )
      }

      if (now.isBefore(promo.startAt) || now.isAfter(promo.endAt)) {
        return c.json(
          ok(
            { isValid: false, discountAmount: 0 },
            'Promo code is not valid at this time',
          ),
          status.OK,
        )
      }

      if (promo.usedCount >= promo.maxUsage) {
        return c.json(
          ok(
            { isValid: false, discountAmount: 0 },
            'Promo code has reached maximum usage',
          ),
          status.OK,
        )
      }

      const discountAmount = calculatePromoDiscount(subtotal, promo)
      if (discountAmount <= 0) {
        return c.json(
          ok(
            { isValid: false, discountAmount: 0 },
            'Promo code is not applicable',
          ),
          status.OK,
        )
      }

      return c.json(
        ok({ isValid: true, discountAmount }, 'Promo code applied'),
        status.OK,
      )
    } catch (err) {
      c.var.logger.fatal(`Error during apply promo: ${err}`)
      throw err
    }
  },
)

export const checkoutHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', extendedCheckoutSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      const validated = c.req.valid('json') as any
      assertClientCheckoutHasNoAddOns(validated)
      const {
        bookingId,
        paymentMethodId,
        courtSlots: rawCourtSlots,
        coachSlots: rawCoachSlots,
        ballboySlots: rawBallboySlots,
        inventories,
        useMembership,
        membershipCourtSlotIds,
        membershipUserId,
        promoCode: rawPromoCode,
      } = validated

      // Clean slot IDs to remove any accidentally appended time suffixes
      const courtSlots = cleanSlotIds(rawCourtSlots)
      const explicitMembershipSelection = membershipCourtSlotIds !== undefined
      const membershipSlotIds = new Set<string>(membershipCourtSlotIds ?? [])
      if (
        explicitMembershipSelection &&
        (membershipSlotIds.size !== membershipCourtSlotIds.length ||
          [...membershipSlotIds].some((id) => !courtSlots?.includes(id)) ||
          (useMembership === false && membershipSlotIds.size > 0))
      ) {
        throw new BadRequestException('Pilihan slot membership tidak valid.')
      }
      const coachSlots = cleanSlotIds(rawCoachSlots)
      const ballboySelections = normalizeBallboySelections(rawBallboySlots)
      const ballboySlots = Array.from(
        new Set(ballboySelections.map((selection) => selection.slotId)),
      )
      const promoCode = normalizePromoCode(rawPromoCode)

      // Validate at least one item is provided
      const hasItems =
        (courtSlots && courtSlots.length > 0) ||
        (coachSlots && coachSlots.length > 0) ||
        (ballboySlots && ballboySlots.length > 0) ||
        (inventories && inventories.length > 0)
      if (!hasItems) {
        return c.json(
          err('At least one item must be selected', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      const paymentMethod = paymentMethodId
        ? await db.paymentMethod.findUnique({ where: { id: paymentMethodId } })
        : null
      if (paymentMethodId && !paymentMethod)
        throw new NotFoundException('Payment method not found')
      if (paymentMethod && !paymentMethod.isActive)
        throw new BadRequestException('Payment method is not active')

      // Use one cutoff for the entire transaction. Client-side filtering is only
      // a UX aid; checkout must reject stale carts and direct API requests too.
      const checkoutStartedAt = new Date()
      const courtCutoff = courtBookingCutoff(checkoutStartedAt)

      const result = await db.$transaction(async (tx) => {
        // Find or create booking
        let booking
        let previousPromoCodeId: string | null = null
        let previousPromoDiscountAmount = 0
        if (bookingId) {
          booking = await tx.booking.findUnique({
            where: { id: bookingId },
            include: {
              details: true,
              coaches: true,
              ballboys: true,
              inventories: true,
            },
          })
          if (!booking) {
            throw new NotFoundException('Booking not found')
          }
          if (booking.userId !== user.id) {
            throw new BadRequestException('Unauthorized access to booking')
          }
          if (booking.status !== BookingStatus.HOLD) {
            throw new BadRequestException('Booking is not in HOLD status')
          }

          previousPromoCodeId = booking.promoCodeId
          previousPromoDiscountAmount = booking.promoDiscountAmount

          // Release previously held slots before rebuilding this HOLD booking
          await releaseSlotsByIds(tx, [
            ...booking.details.map((detail) => detail.slotId),
            ...booking.coaches.map((coach) => coach.slotId),
            ...booking.ballboys.map((ballboy) => ballboy.slotId),
          ])

          // Clear existing details
          await tx.bookingDetail.deleteMany({
            where: { bookingId: booking.id },
          })
          await tx.bookingCoach.deleteMany({
            where: { bookingId: booking.id },
          })
          await tx.bookingBallboy.deleteMany({
            where: { bookingId: booking.id },
          })
          for (const bookingInventory of booking.inventories.filter(
            (inventory: { returnedAt: Date | null }) => !inventory.returnedAt,
          )) {
            await tx.inventory.update({
              where: { id: bookingInventory.inventoryId },
              data: {
                quantity: { increment: bookingInventory.quantity },
              },
            })
          }
          await tx.bookingInventory.deleteMany({
            where: { bookingId: booking.id },
          })

          if (previousPromoCodeId && previousPromoDiscountAmount > 0) {
            await tx.promoCode.updateMany({
              where: {
                id: previousPromoCodeId,
                usedCount: { gt: 0 },
              },
              data: {
                usedCount: { decrement: 1 },
              },
            })
          }
        } else {
          booking = await tx.booking.create({
            data: {
              userId: user.id,
              status: BookingStatus.HOLD,
              totalPrice: 0,
              processingFee: 0,
            },
          })
        }

        let totalPrice = 0
        let courtNormalPrice = 0
        let courtDiscountPrice = 0
        let promoDiscountAmount = 0
        let appliedPromoCodeId: string | null = null
        let appliedPromoCodeText: string | null = null
        let selectedCourtSport: CourtSport | null = null
        let selectedCourtSlots: Array<{
          id: string
          startAt: Date
          endAt: Date
          court?: { sport: CourtSport } | null
        }> = []
        let selectedCoachSlots: Array<{
          startAt: Date
          endAt: Date
        }> = []
        let membershipSessionsToUse = 0
        let activeMembership:
          | (MembershipUser & { membership: Membership })
          | null = null
        const xenditItems: Array<{
          name: string
          quantity: number
          price: number
        }> = []

        // Process court slots
        if (courtSlots && courtSlots.length > 0) {
          const courtSlotData = await tx.slot.findMany({
            where: {
              id: { in: courtSlots },
              ...rollingBookingWindowWhere(),
              type: SlotType.COURT,
              isAvailable: true,
              court: { is: bookableCourtWhere },
            },
            include: {
              court: {
                select: {
                  sport: true,
                },
              },
              bookingDetails: {
                where: {
                  booking: {
                    status: {
                      not: BookingStatus.CANCELLED,
                    },
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })

          if (courtSlotData.length !== courtSlots.length) {
            throw new BadRequestException(
              'One or more court slots not found or unavailable',
            )
          }
          if (
            courtSlotData.some(
              (slot) => slot.startAt.getTime() <= courtCutoff.getTime(),
            )
          ) {
            throw new BadRequestException(
              'One or more court slots are past the 15-minute booking grace period',
            )
          }
          selectedCourtSlots = courtSlotData
          const courtSports = Array.from(
            new Set(
              courtSlotData.map((slot) => slot.court?.sport).filter(Boolean),
            ),
          ) as CourtSport[]
          if (courtSports.length > 1) {
            throw new BadRequestException(
              'Cannot checkout mixed padel and tennis court slots',
            )
          }
          selectedCourtSport = courtSports[0] ?? null
          const membershipSlots = explicitMembershipSelection
            ? courtSlotData.filter((slot) => membershipSlotIds.has(slot.id))
            : courtSlotData
          membershipSessionsToUse =
            calculateMembershipSessionsForCourtSlots(membershipSlots)

          if (
            useMembership &&
            selectedCourtSport &&
            membershipSessionsToUse > 0
          ) {
            const membershipCandidates = await tx.membershipUser.findMany({
              where: {
                userId: user.id,
                ...(membershipUserId ? { id: membershipUserId } : {}),
                isExpired: false,
                isSuspended: false,
                startDate: { lte: new Date() },
                endDate: { gt: new Date() },
                remainingSessions: { gte: membershipSessionsToUse },
                invoice: { status: PaymentStatus.PAID },
                membership: {
                  sport: selectedCourtSport,
                },
              },
              include: {
                membership: true,
              },
              orderBy: {
                endDate: 'asc',
              },
            })

            const membershipTariffRules = await getTariffPeriods(tx)
            activeMembership =
              membershipCandidates.find((candidate) =>
                membershipSlots.every((slot) =>
                  isSlotAllowedForMembershipType(
                    candidate.membership.type,
                    slot.startAt,
                    {
                      rules: membershipTariffRules,
                      branchId: slot.branchId,
                      sport: slot.court?.sport,
                      endAt: slot.endAt,
                    },
                  ),
                ),
              ) ?? null
          }

          if (
            explicitMembershipSelection &&
            membershipSlotIds.size > 0 &&
            !activeMembership
          ) {
            throw new BadRequestException(
              'Membership tidak tersedia, kuota tidak cukup, atau jam yang dipilih tidak sesuai paket.',
            )
          }

          for (const slot of courtSlotData) {
            if (slot.bookingDetails.length > 0) {
              throw new BadRequestException(
                'One or more court slots are already booked',
              )
            }
          }

          await claimSlotsAtomically(tx, {
            slotIds: courtSlots,
            type: SlotType.COURT,
            startsAfter: courtCutoff,
            unavailableMessage:
              'One or more court slots not found or unavailable',
          })

          for (const slot of courtSlotData) {
            const normalPrice = slot.price
            const discountedPrice =
              slot.discountPrice && slot.discountPrice > 0
                ? slot.discountPrice
                : slot.price
            const paidCourtPrice =
              activeMembership &&
              (!explicitMembershipSelection || membershipSlotIds.has(slot.id))
                ? 0
                : discountedPrice
            courtNormalPrice += normalPrice
            courtDiscountPrice += paidCourtPrice
            totalPrice += paidCourtPrice

            await tx.bookingDetail.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                price: normalPrice,
                discountPrice: paidCourtPrice,
                courtId: slot.courtId || undefined,
              },
            })
            if (paidCourtPrice > 0) {
              xenditItems.push({
                name: `Court booking ${dayjs(slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(slot.endAt).format('HH:mm')}`,
                quantity: 1,
                price: paidCourtPrice,
              })
            }
          }
        }

        // Process coach slots
        if (coachSlots && coachSlots.length > 0) {
          const coachSlotData = await tx.slot.findMany({
            where: {
              id: { in: coachSlots },
              type: SlotType.COACH,
              isAvailable: true,
            },
            include: {
              staff: {
                select: {
                  coachType: true,
                },
              },
              bookingCoaches: {
                where: {
                  status: {
                    not: BookingStatus.CANCELLED,
                  },
                  booking: {
                    status: {
                      not: BookingStatus.CANCELLED,
                    },
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })

          if (coachSlotData.length !== coachSlots.length) {
            throw new BadRequestException(
              'One or more coach slots not found or unavailable',
            )
          }
          if (
            coachSlotData.some(
              (slot) => slot.startAt.getTime() <= checkoutStartedAt.getTime(),
            )
          ) {
            throw new BadRequestException(
              'One or more coach slots have already started',
            )
          }
          selectedCoachSlots = coachSlotData
          if (selectedCourtSport) {
            const allowedCoachTypes: CoachType[] =
              selectedCourtSport === CourtSport.PADEL
                ? [CoachType.PADEL, CoachType.PADEL_TENNIS]
                : [CoachType.TENNIS, CoachType.PADEL_TENNIS]
            if (
              coachSlotData.some(
                (slot) =>
                  slot.staff?.coachType &&
                  !allowedCoachTypes.includes(slot.staff.coachType),
              )
            ) {
              throw new BadRequestException(
                'One or more coach slots do not match the selected court sport',
              )
            }
          }

          try {
            await assertCoachSlotsDoNotConflict(tx, coachSlotData)
          } catch (error) {
            throw new BadRequestException(
              error instanceof Error
                ? error.message
                : 'Coach schedule conflicts with another booking',
            )
          }

          for (const slot of coachSlotData) {
            if (slot.bookingCoaches.length > 0) {
              throw new BadRequestException(
                'One or more coach slots are already booked',
              )
            }
          }

          await claimSlotsAtomically(tx, {
            slotIds: coachSlots,
            type: SlotType.COACH,
            startsAfter: checkoutStartedAt,
            unavailableMessage:
              'One or more coach slots not found or unavailable',
          })

          for (const slot of coachSlotData) {
            totalPrice += slot.price

            // Get coach type for the staff
            const coachTypes = await tx.bookingCoachType.findMany()
            const firstCoachType = coachTypes[0]
            if (!firstCoachType) {
              throw new BadRequestException('No coach types available')
            }

            await tx.bookingCoach.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                bookingCoachTypeId: firstCoachType.id,
                price: slot.price,
              },
            })
            xenditItems.push({
              name: `Coach session ${dayjs(slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(slot.endAt).format('HH:mm')}`,
              quantity: 1,
              price: slot.price,
            })
          }
        }

        if (
          !activeMembership &&
          selectedCourtSlots.length > 0 &&
          selectedCoachSlots.length > 0
        ) {
          const bundleDiscountByCourtSlot =
            getCourtCoachBundleDiscountByCourtSlot(
              selectedCourtSlots,
              selectedCoachSlots,
              await getTariffPeriods(tx),
            )

          for (const slot of selectedCourtSlots) {
            const rawDiscount = bundleDiscountByCourtSlot.get(slot.id) ?? 0
            if (rawDiscount <= 0) continue

            const bookingDetail = await tx.bookingDetail.findFirst({
              where: { bookingId: booking.id, slotId: slot.id },
              select: { id: true, discountPrice: true },
            })
            if (!bookingDetail || bookingDetail.discountPrice <= 0) continue

            const discount = Math.min(rawDiscount, bookingDetail.discountPrice)
            await tx.bookingDetail.update({
              where: { id: bookingDetail.id },
              data: {
                discountPrice: {
                  decrement: discount,
                },
              },
            })
            totalPrice -= discount
            courtDiscountPrice -= discount
          }
        }

        // Process ballboy slots
        if (ballboySlots && ballboySlots.length > 0) {
          const ballboySlotData = await tx.slot.findMany({
            where: {
              id: { in: ballboySlots },
              type: SlotType.BALLBOY,
              isAvailable: true,
            },
            include: {
              bookingBallboys: {
                where: {
                  status: {
                    not: BookingStatus.CANCELLED,
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })

          if (ballboySlotData.length !== ballboySlots.length) {
            throw new BadRequestException(
              'One or more ballboy slots not found or unavailable',
            )
          }
          if (
            ballboySlotData.some(
              (slot) => slot.startAt.getTime() <= checkoutStartedAt.getTime(),
            )
          ) {
            throw new BadRequestException(
              'One or more ballboy slots have already started',
            )
          }

          validateBallboysForTennisCourts(
            ballboySelections,
            ballboySlotData,
            selectedCourtSlots,
          )
          const ballboySelectionBySlotId = new Map(
            ballboySelections.map((selection) => [
              selection.slotId,
              selection.courtSlotId,
            ]),
          )

          for (const slot of ballboySlotData) {
            if (slot.bookingBallboys.length > 0) {
              throw new BadRequestException(
                'One or more ballboy slots are already booked',
              )
            }
          }

          await claimSlotsAtomically(tx, {
            slotIds: ballboySlots,
            type: SlotType.BALLBOY,
            startsAfter: checkoutStartedAt,
            unavailableMessage:
              'One or more ballboy slots not found or unavailable',
          })

          for (const slot of ballboySlotData) {
            totalPrice += slot.price

            await tx.bookingBallboy.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                courtSlotId: ballboySelectionBySlotId.get(slot.id),
                price: slot.price,
              },
            })
            xenditItems.push({
              name: `Ballboy session ${dayjs(slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(slot.endAt).format('HH:mm')}`,
              quantity: 1,
              price: slot.price,
            })
          }
        }

        // Process inventories
        if (inventories && inventories.length > 0) {
          const courtSlotById = new Map(
            selectedCourtSlots.map((slot) => [slot.id, slot]),
          )
          const processedInventorySelections: Array<{
            inventoryId: string
            quantity: number
            startAt?: Date
            endAt?: Date
          }> = []
          const overallInventoryRange =
            selectedCourtSlots.length > 0
              ? {
                  startAt: dayjs(
                    Math.min(
                      ...selectedCourtSlots.map((slot) =>
                        dayjs(slot.startAt).valueOf(),
                      ),
                    ),
                  ).toDate(),
                  endAt: dayjs(
                    Math.max(
                      ...selectedCourtSlots.map((slot) =>
                        dayjs(slot.endAt).valueOf(),
                      ),
                    ),
                  ).toDate(),
                }
              : null
          const inventoryAvailabilityByRange = new Map<
            string,
            Awaited<ReturnType<typeof getInventoryAvailabilityMap>>
          >()
          const getAvailabilityForRange = async (
            startAt?: Date,
            endAt?: Date,
          ) => {
            if (!startAt || !endAt) return null
            const key = `${startAt.toISOString()}|${endAt.toISOString()}`
            if (!inventoryAvailabilityByRange.has(key)) {
              inventoryAvailabilityByRange.set(
                key,
                await getInventoryAvailabilityMap(tx, {
                  courtSport: selectedCourtSport ?? undefined,
                  startAt: startAt.toISOString(),
                  endAt: endAt.toISOString(),
                }),
              )
            }
            return inventoryAvailabilityByRange.get(key) ?? null
          }
          const overallAvailability = overallInventoryRange
            ? await getAvailabilityForRange(
                overallInventoryRange.startAt,
                overallInventoryRange.endAt,
              )
            : null

          for (const inv of inventories) {
            const courtSlot = inv.courtSlotId
              ? courtSlotById.get(inv.courtSlotId)
              : undefined
            if (inv.courtSlotId && !courtSlot) {
              throw new BadRequestException(
                'Inventory selection must match a selected court booking slot',
              )
            }
            const inventory = await tx.inventory.findUnique({
              where: { id: inv.inventoryId },
            })
            if (!inventory) {
              throw new NotFoundException(
                `Inventory ${inv.inventoryId} not found`,
              )
            }
            if (!inventory.isActive) {
              throw new BadRequestException(
                `Inventory ${inventory.name} is not active`,
              )
            }
            if (selectedCourtSport && inventory.sport !== selectedCourtSport) {
              throw new BadRequestException(
                `Inventory ${inventory.name} does not match the selected court sport`,
              )
            }
            const selectionRange = courtSlot
              ? { startAt: courtSlot.startAt, endAt: courtSlot.endAt }
              : overallInventoryRange
            const availableQuantity =
              (courtSlot
                ? await getAvailabilityForRange(
                    courtSlot.startAt,
                    courtSlot.endAt,
                  )
                : overallAvailability
              )?.get(inv.inventoryId)?.availableQuantity ?? inventory.quantity
            const overlappingRequestedQuantity = processedInventorySelections
              .filter((selection) => selection.inventoryId === inv.inventoryId)
              .reduce((total, selection) => {
                if (
                  !selectionRange ||
                  !selection.startAt ||
                  !selection.endAt ||
                  timeRangesOverlap(selectionRange, {
                    startAt: selection.startAt,
                    endAt: selection.endAt,
                  })
                ) {
                  return total + selection.quantity
                }

                return total
              }, 0)
            const remainingAvailableQuantity = Math.max(
              0,
              availableQuantity - overlappingRequestedQuantity,
            )
            if (remainingAvailableQuantity < inv.quantity) {
              throw new BadRequestException(
                `Insufficient quantity for ${inventory.name} at the selected booking time`,
              )
            }

            const inventoryPrice = inventory.price * inv.quantity
            totalPrice += inventoryPrice

            await tx.bookingInventory.create({
              data: {
                bookingId: booking.id,
                inventoryId: inv.inventoryId,
                slotId: inv.courtSlotId,
                quantity: inv.quantity,
                price: inventory.price, // unit price captured at checkout
              },
            })
            processedInventorySelections.push({
              inventoryId: inv.inventoryId,
              quantity: inv.quantity,
              startAt: selectionRange?.startAt,
              endAt: selectionRange?.endAt,
            })
            // Decrement inventory stock immediately (like admin checkout)
            await tx.inventory.update({
              where: { id: inv.inventoryId },
              data: {
                quantity: { decrement: inv.quantity },
              },
            })
            xenditItems.push({
              name: `Inventory - ${inventory.name}`,
              quantity: inv.quantity,
              price: inventory.price,
            })
          }
        }

        if (activeMembership && membershipSessionsToUse > 0) {
          await consumeMembershipHours(
            tx,
            activeMembership.id,
            membershipSessionsToUse,
          )
        }

        if (promoCode) {
          const promo = await tx.promoCode.findUnique({
            where: { code: promoCode },
          })
          if (!promo) {
            throw new BadRequestException('Promo code not found')
          }

          const now = dayjs()
          if (promo.status !== 'ACTIVE') {
            throw new BadRequestException('Promo code is not active')
          }
          if (now.isBefore(promo.startAt) || now.isAfter(promo.endAt)) {
            throw new BadRequestException(
              'Promo code is not valid at this time',
            )
          }
          if (promo.usedCount >= promo.maxUsage) {
            throw new BadRequestException(
              'Promo code has reached maximum usage',
            )
          }

          promoDiscountAmount = calculatePromoDiscount(totalPrice, promo)
          if (promoDiscountAmount <= 0) {
            throw new BadRequestException('Promo code is not applicable')
          }

          totalPrice -= promoDiscountAmount

          const updatePromoUsage = await tx.promoCode.updateMany({
            where: {
              id: promo.id,
              usedCount: { lt: promo.maxUsage },
            },
            data: {
              usedCount: { increment: 1 },
            },
          })
          if (updatePromoUsage.count === 0) {
            throw new BadRequestException(
              'Promo code has reached maximum usage',
            )
          }

          appliedPromoCodeId = promo.id
          appliedPromoCodeText = promo.code
        }

        // Only a server-validated membership covering the entire order can bypass payment.
        const coveredByMembership =
          !!activeMembership && membershipSessionsToUse > 0 && totalPrice === 0
        if (!coveredByMembership && !paymentMethod)
          throw new BadRequestException(
            'Pilih metode pembayaran. Pesanan masih memiliki biaya yang harus dibayar.',
          )
        const percentageFee = coveredByMembership
          ? 0
          : Math.round(
              totalPrice * (Number(paymentMethod?.percentage ?? 0) / 100),
            )
        const baseFee = coveredByMembership
          ? 0
          : (paymentMethod?.fees ?? 0) + percentageFee
        const processingFee = baseFee + Math.round(baseFee * 0.11)
        const finalTotal = totalPrice + processingFee

        if (processingFee > 0) {
          xenditItems.push({
            name: 'Processing fee',
            quantity: 1,
            price: processingFee,
          })
        }

        // Update booking with totals
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            totalPrice,
            processingFee,
            courtNormalPrice,
            courtDiscountPrice,
            promoCodeId: appliedPromoCodeId,
            promoCodeText: appliedPromoCodeText,
            promoDiscountAmount,
            membershipUserId: activeMembership?.id,
            membershipSessionsUsed: activeMembership
              ? membershipSessionsToUse
              : 0,
          },
        })

        // (User details fetched later per-channel when needed)

        // Generate invoice number
        const invoiceNumber = await generateInvoiceNumber()

        // Create invoice
        const issuedAt = new Date()
        const invoice = await tx.invoice.create({
          data: {
            userId: user.id,
            bookingId: booking.id,
            number: invoiceNumber,
            subtotal: totalPrice,
            processingFee,
            total: finalTotal,
            promoCodeId: appliedPromoCodeId,
            promoCodeText: appliedPromoCodeText,
            promoDiscountAmount,
            status: coveredByMembership
              ? PaymentStatus.PAID
              : PaymentStatus.PENDING,
            paidAt: coveredByMembership ? issuedAt : null,
            // dueDate is required even when membership settles the invoice immediately.
            dueDate: coveredByMembership ? issuedAt : paymentDeadline(issuedAt),
            issuedAt,
          },
        })

        if (coveredByMembership) {
          const confirmedBooking = await tx.booking.update({
            where: { id: booking.id },
            data: { status: BookingStatus.CONFIRMED, holdExpiresAt: null },
          })
          return {
            booking: confirmedBooking,
            invoice,
            payment: null,
            xenditPaymentRequest: null,
          }
        }
        if (!paymentMethod)
          throw new BadRequestException('Payment method is required')

        // --- OLD v2 Invoice (disabled, see below to re-enable) ---
        /*
        let xenditInvoiceResponse: any = null
        if (env.xendit.apiKey) {
          try {
            xenditInvoiceResponse = await xenditService.createInvoice({
              externalId: invoice.number,
              amount: finalTotal,
              payerEmail: userDetails?.email || undefined,
              description: `Payment for booking ${booking.id}`,
              invoiceDuration: 600, // 10 minutes
              successRedirectUrl: `${env.baseUrl}/payment/success`,
              failureRedirectUrl: `${env.baseUrl}/payment/failed`,
              items: xenditItems,
              customer: {
                givenNames: userDetails?.name || 'Customer',
                email: userDetails?.email || undefined,
                mobileNumber: userDetails?.phone || undefined,
              },
              // payment_methods: paymentMethod.channel ? [paymentMethod.channel] : undefined, // Only needed if supporting v2 and you've implemented preference filtering
            })
          } catch (error) {
            c.var.logger.error(`Failed to create Xendit invoice: ${error}`)
            // Continue without Xendit integration
          }
        }
        */

        let xenditInvoiceResponse: any = null
        if (paymentMethod.channel) {
          if (!env.midtrans.serverKey) {
            throw new BadRequestException(
              'Payment gateway unavailable. Please try again later (missing API key).',
            )
          }
          if (validated.cardPayment?.savedCardId) {
            throw new BadRequestException(
              'Saved card flow is not yet implemented. Please use a new card for now.',
            )
          }
          try {
            const channelCode = paymentMethod.channel || ''
            const userDetails = await tx.user.findUnique({
              where: { id: user.id },
              select: { name: true, email: true, phone: true },
            })
            c.var.logger.info(
              `Creating Midtrans charge channel=${channelCode} amount=${finalTotal}`,
            )
            xenditInvoiceResponse = await midtransService.charge({
              orderId: invoiceNumber,
              amount: finalTotal,
              channelCode,
              expiryMinutes:
                channelCode === 'CARDS' ? undefined : PAYMENT_WINDOW_MINUTES,
              tokenId: validated.cardPayment?.tokenId,
              customer: userDetails ?? undefined,
              description: `Payment for booking ${booking.id}`,
            })
          } catch (errX: any) {
            const errMsg = errX?.message || 'Payment gateway error'
            c.var.logger.error(`Midtrans error: ${errMsg}`)
            throw new BadRequestException(
              `Unable to initialize payment. ${errMsg}`,
            )
          }
        }

        // Create payment
        const payment = await tx.payment.create({
          data: {
            paymentMethodId: paymentMethod.id,
            amount: finalTotal,
            fees: paymentMethod.fees,
            status: PaymentStatus.PENDING,
            dueDate: invoice.dueDate,
            externalRef: xenditInvoiceResponse?.transaction_id || null,
            meta: xenditInvoiceResponse
              ? {
                  gateway: 'midtrans',
                  payment_request_id: xenditInvoiceResponse.transaction_id,
                  transaction_id: xenditInvoiceResponse.transaction_id,
                  order_id: xenditInvoiceResponse.order_id,
                  reference_id: xenditInvoiceResponse.reference_id,
                  status: xenditInvoiceResponse.status,
                  channel_code: xenditInvoiceResponse.channel_code,
                  channel_properties: xenditInvoiceResponse.channel_properties,
                  actions: xenditInvoiceResponse.actions,
                  request_amount: xenditInvoiceResponse.request_amount,
                  currency: xenditInvoiceResponse.currency,
                  created: xenditInvoiceResponse.created,
                  redirect_url: xenditInvoiceResponse.redirect_url,
                }
              : undefined,
          },
        })

        // Link payment to invoice
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paymentId: payment.id },
        })

        // Keep the reservation and payment on the same deadline.
        const holdExpiresAt = invoice.dueDate

        // Update booking status to HOLD
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.HOLD,
            holdExpiresAt,
          },
        })

        return {
          booking,
          invoice,
          payment,
          xenditPaymentRequest: xenditInvoiceResponse,
        }
      })

      try {
        await notificationService.createBookingAdminNotification(
          result.booking.id,
          result.invoice.number,
        )
      } catch (e) {
        c.var.logger.warn(`Failed to create booking admin notification: ${e}`)
      }

      // Extract payment session or payment actions for frontend
      let paymentSessionId: string | null = null
      let paymentActions: any = null
      let redirectUrl: string | null = null

      // For credit cards: return payment_session_id to use with card_session.js
      if (result.xenditPaymentRequest?.payment_session_id) {
        paymentSessionId = result.xenditPaymentRequest.payment_session_id
      }
      // For other payment methods: return payment actions (VA, QRIS, etc.)
      else if (
        result.xenditPaymentRequest?.actions &&
        result.xenditPaymentRequest.actions.length > 0
      ) {
        paymentActions = result.xenditPaymentRequest.actions.map(
          (action: any) => ({
            type: action.type,
            value: action.value,
            descriptor: action.descriptor,
          }),
        )

        // Find redirect URL if available
        const redirectAction = result.xenditPaymentRequest.actions.find(
          (a: any) => a.type === 'REDIRECT_CUSTOMER',
        )
        redirectUrl = redirectAction?.value || null
      }

      return c.json(
        ok(
          {
            bookingId: result.booking.id,
            invoiceId: result.invoice.id,
            invoiceNumber: result.invoice.number,
            totalPrice: result.booking.totalPrice,
            processingFee: result.booking.processingFee,
            total: result.invoice.total,
            promoDiscountAmount: result.invoice.promoDiscountAmount,
            status: result.booking.status,
            paymentStatus:
              result.invoice.status === PaymentStatus.PAID
                ? 'PAID'
                : result.xenditPaymentRequest?.status || 'PENDING',
            // For credit cards: payment_session_id to use with card_session.js
            ...(paymentSessionId && { paymentSessionId }),
            // For other channels: payment actions (VA, QRIS, etc.)
            ...(paymentActions && { paymentActions }),
            // Legacy support
            paymentUrl: redirectUrl,
          },
          'Checkout successful',
        ),
      )
    } catch (err) {
      c.var.logger.fatal(`Error during checkout: ${err}`)
      throw err
    }
  },
)

// Validation schema for cancel payment session
const cancelPaymentSessionSchema = z.object({
  sessionId: z.string().min(1, 'Payment session ID is required'),
})

/**
 * Cancel Payment Session Handler
 *
 * Cancels an active payment session via Xendit's POST /sessions/{id}/cancel endpoint.
 * This is useful when:
 * - User abandons the payment
 * - User wants to change payment method
 * - Booking needs to be cancelled before payment completion
 *
 * Flow:
 * 1. Client sends payment_session_id
 * 2. Backend calls Xendit cancel API
 * 3. Session status becomes CANCELED
 * 4. No payment requests can be created from this session anymore
 */
export const cancelPaymentSessionHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', cancelPaymentSessionSchema, validateHook),
  async (c) => {
    const user = c.get('user')
    if (!user || !user.id) {
      return c.json(
        err('Unauthorized', status.UNAUTHORIZED),
        status.UNAUTHORIZED,
      )
    }

    const { sessionId } = c.req.valid('json')

    try {
      c.var.logger.info(
        `User ${user.id} is cancelling payment session: ${sessionId}`,
      )

      const payment = await db.payment.findFirst({
        where: {
          OR: [
            { externalRef: sessionId },
            { meta: { path: ['order_id'], equals: sessionId } },
            { meta: { path: ['transaction_id'], equals: sessionId } },
          ],
        },
        include: { invoice: { select: { userId: true } } },
      })
      const meta = payment?.meta as {
        gateway?: string
        order_id?: string
      } | null
      if (meta?.gateway === 'midtrans' && meta.order_id) {
        if (payment?.invoice && payment.invoice.userId !== user.id) {
          throw new NotFoundException(
            'Payment session not found or cannot be cancelled',
          )
        }
        await midtransService.cancel(meta.order_id)
        return c.json(
          ok(
            {
              sessionId: meta.order_id,
              status: 'cancel',
              message: 'Payment cancelled successfully',
            },
            'Payment cancelled',
          ),
          status.OK,
        )
      }

      const cancelledSession =
        await xenditService.cancelPaymentSession(sessionId)

      if (!cancelledSession) {
        throw new NotFoundException(
          'Payment session not found or cannot be cancelled',
        )
      }

      c.var.logger.info(
        `Payment session cancelled successfully: ${sessionId}, Status: ${cancelledSession.status}`,
      )

      return c.json(
        ok(
          {
            sessionId: cancelledSession.payment_session_id,
            status: cancelledSession.status,
            message: 'Payment session cancelled successfully',
          },
          'Payment session cancelled',
        ),
        status.OK,
      )
    } catch (err) {
      c.var.logger.error(
        `Error cancelling payment session ${sessionId}: ${err}`,
      )
      throw err
    }
  },
)
