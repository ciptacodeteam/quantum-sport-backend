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
import { xenditService } from '@/services/xendit.service'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, CoachType, CourtSport, PaymentStatus, SlotType } from '@prisma/client'
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
  return slotIds.map((id) => id.replace(/-\d{2}:\d{2}(:\d{2})?$/, ''))
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

function getSlotTimeKey(slot: { startAt: Date; endAt: Date }): string {
  return `${dayjs(slot.startAt).toISOString()}|${dayjs(slot.endAt).toISOString()}`
}

function validateBallboysForTennisCourts(
  ballboySlots: Array<{ startAt: Date; endAt: Date }>,
  courtSlots: Array<{ startAt: Date; endAt: Date; court?: { sport: CourtSport } | null }>,
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

  const courtSlotCountByTime = new Map<string, number>()
  for (const slot of courtSlots) {
    const key = getSlotTimeKey(slot)
    courtSlotCountByTime.set(key, (courtSlotCountByTime.get(key) ?? 0) + 1)
  }

  const ballboySlotCountByTime = new Map<string, number>()
  for (const slot of ballboySlots) {
    const key = getSlotTimeKey(slot)
    ballboySlotCountByTime.set(key, (ballboySlotCountByTime.get(key) ?? 0) + 1)
  }

  for (const [key, ballboyCount] of ballboySlotCountByTime) {
    const courtCount = courtSlotCountByTime.get(key) ?? 0
    if (courtCount === 0) {
      throw new BadRequestException(
        'Ballboy slots must match selected tennis court booking times',
      )
    }
    if (ballboyCount > courtCount) {
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
async function handleCreditCardPayment(
  tx: any,
  paymentMethodId: string,
  invoiceNumber: string,
  bookingId: string,
  userId: string,
  finalTotal: number,
  cardPaymentData?: any,
) {
  // Check if payment method is credit card
  const paymentMethod = await tx.paymentMethod.findUnique({
    where: { id: paymentMethodId },
  })

  if (!paymentMethod || paymentMethod.channel !== 'CARDS') {
    return null
  }

  // Get user details for customer object (required by Xendit)
  const userDetails = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true },
  })

  if (!userDetails) {
    throw new BadRequestException('User not found')
  }

  try {
    // TODO: Handle saved card flow via payment_token_id
    // For now, savedCardId is not supported - will be implemented after webhook integration
    if (cardPaymentData?.savedCardId) {
      throw new BadRequestException(
        'Saved card flow is not yet implemented. Please use a new card for now.',
      )
    }

    // Determine session type based on saveCard flag
    const shouldSaveCard = Boolean(cardPaymentData?.saveCard)
    const sessionType: 'PAY' | 'PAY_AND_SAVE' = shouldSaveCard
      ? 'PAY_AND_SAVE'
      : 'PAY'

    // Parse customer name
    const fullName = String(userDetails.name || 'Customer').trim()
    const nameParts = fullName.split(/\s+/).filter(Boolean)
    const givenNames = nameParts[0] || 'Customer'
    const surname =
      nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined

    // Generate unique customer reference ID (to handle multiple transactions by same user)
    const customerReferenceId = `${userId}-${Date.now()}`

    // Create payment session (Xendit will handle card collection via card_session.js)
    const paymentSession = await xenditService.createPaymentSession({
      sessionType,
      mode: 'CARDS_SESSION_JS',
      referenceId: invoiceNumber,
      amount: finalTotal,
      currency: 'IDR',
      country: 'ID',
      description: `Payment for booking ${bookingId}`,
      metadata: {
        bookingId,
        userId,
        invoiceNumber,
        paymentType: 'cards_3ds',
      },
      customer: {
        reference_id: customerReferenceId,
        type: 'INDIVIDUAL',
        individual_detail: {
          given_names: givenNames,
          ...(surname && { surname }),
        },
        email: userDetails.email || undefined,
        mobileNumber: userDetails.phone || undefined,
      },
      cardsSessionJs: {
        successReturnUrl: `${env.frontEndUrl}/invoice/${invoiceNumber}`,
        failureReturnUrl: `${env.frontEndUrl}/payment/failed?invoice_id=${invoiceNumber}`,
      },
    })

    if (!paymentSession) {
      throw new BadRequestException('Unable to create payment session')
    }

    // Return payment session - frontend will use payment_session_id with card_session.js
    return paymentSession
  } catch (error) {
    console.error('Credit card payment session error:', error)
    throw error
  }
}

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
      const ballboySlots = cleanSlotIds(rawBallboySlots)

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
          startAt: Date
          endAt: Date
          court?: { sport: CourtSport } | null
        }> = []

        if (courtSlots && courtSlots.length > 0) {
          const courtSlotData = await tx.slot.findMany({
            where: {
              id: { in: courtSlots },
              type: SlotType.COURT,
              isAvailable: true,
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

          for (const slot of coachSlotData) {
            if (slot.bookingCoaches.length > 0) {
              throw new BadRequestException(
                'One or more coach slots are already booked',
              )
            }
            totalPrice += slot.price
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

          if (ballboySlotData.length !== ballboySlots.length) {
            throw new BadRequestException(
              'One or more ballboy slots not found or unavailable',
            )
          }

          validateBallboysForTennisCourts(ballboySlotData, selectedCourtSlots)

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
          ok(
            { isValid: false, discountAmount: 0 },
            'Promo code not found',
          ),
          status.OK,
        )
      }

      const now = dayjs()
      if (promo.status !== 'ACTIVE') {
        return c.json(
          ok(
            { isValid: false, discountAmount: 0 },
            'Promo code is not active',
          ),
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
      const {
        bookingId,
        paymentMethodId,
        courtSlots: rawCourtSlots,
        coachSlots: rawCoachSlots,
        ballboySlots: rawBallboySlots,
        inventories,
        useMembership,
        promoCode: rawPromoCode,
      } = validated

      // Clean slot IDs to remove any accidentally appended time suffixes
      const courtSlots = cleanSlotIds(rawCourtSlots)
      const coachSlots = cleanSlotIds(rawCoachSlots)
      const ballboySlots = cleanSlotIds(rawBallboySlots)
      const promoCode = normalizePromoCode(rawPromoCode)

      // Validate at least one slot is provided
      const hasSlots =
        (courtSlots && courtSlots.length > 0) ||
        (coachSlots && coachSlots.length > 0) ||
        (ballboySlots && ballboySlots.length > 0)
      if (!hasSlots) {
        return c.json(
          err('At least one slot must be selected', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      // Validate payment method
      const paymentMethod = await db.paymentMethod.findUnique({
        where: { id: paymentMethodId },
      })
      if (!paymentMethod) {
        throw new NotFoundException('Payment method not found')
      }
      if (!paymentMethod.isActive) {
        return c.json(
          err('Payment method is not active', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

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
          startAt: Date
          endAt: Date
          court?: { sport: CourtSport } | null
        }> = []
        let activeMembership: (MembershipUser & { membership: Membership }) | null = null
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
              type: SlotType.COURT,
              isAvailable: true,
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
          const courtSports = Array.from(
            new Set(courtSlotData.map((slot) => slot.court?.sport).filter(Boolean)),
          ) as CourtSport[]
          if (courtSports.length > 1) {
            throw new BadRequestException(
              'Cannot checkout mixed padel and tennis court slots',
            )
          }
          selectedCourtSport = courtSports[0] ?? null

          if (useMembership && selectedCourtSport) {
            const membershipCandidates = await tx.membershipUser.findMany({
              where: {
                userId: user.id,
                isExpired: false,
                isSuspended: false,
                startDate: { lte: new Date() },
                endDate: { gt: new Date() },
                remainingSessions: { gte: courtSlotData.length },
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

            activeMembership =
              membershipCandidates.find((candidate) =>
                courtSlotData.every((slot) =>
                  isSlotAllowedForMembershipType(candidate.membership.type, slot.startAt),
                ),
              ) ?? null
          }

          for (const slot of courtSlotData) {
            if (slot.bookingDetails.length > 0) {
              throw new BadRequestException(
                'One or more court slots are already booked',
              )
            }
            const normalPrice = slot.price
            const discountedPrice =
              slot.discountPrice && slot.discountPrice > 0
                ? slot.discountPrice
                : slot.price
            const paidCourtPrice = activeMembership ? 0 : discountedPrice
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
          // Update slots to unavailable
          await tx.slot.updateMany({
            where: {
              id: { in: courtSlots },
            },
            data: {
              isAvailable: false,
            },
          })
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
          if (selectedCourtSport) {
            const allowedCoachTypes =
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

          for (const slot of coachSlotData) {
            if (slot.bookingCoaches.length > 0) {
              throw new BadRequestException(
                'One or more coach slots are already booked',
              )
            }
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
          // Update slots to unavailable
          await tx.slot.updateMany({
            where: {
              id: { in: coachSlots },
            },
            data: {
              isAvailable: false,
            },
          })
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

          if (ballboySlotData.length !== ballboySlots.length) {
            throw new BadRequestException(
              'One or more ballboy slots not found or unavailable',
            )
          }

          validateBallboysForTennisCourts(ballboySlotData, selectedCourtSlots)

          for (const slot of ballboySlotData) {
            if (slot.bookingBallboys.length > 0) {
              throw new BadRequestException(
                'One or more ballboy slots are already booked',
              )
            }
            totalPrice += slot.price

            await tx.bookingBallboy.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                price: slot.price,
              },
            })
            xenditItems.push({
              name: `Ballboy session ${dayjs(slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(slot.endAt).format('HH:mm')}`,
              quantity: 1,
              price: slot.price,
            })
          }
          // Update slots to unavailable
          await tx.slot.updateMany({
            where: {
              id: { in: ballboySlots },
            },
            data: {
              isAvailable: false,
            },
          })
        }

        // Process inventories
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
            if (selectedCourtSport && inventory.sport !== selectedCourtSport) {
              throw new BadRequestException(
                `Inventory ${inventory.name} does not match the selected court sport`,
              )
            }
            if (inventory.quantity < inv.quantity) {
              throw new BadRequestException(
                `Insufficient quantity for ${inventory.name}`,
              )
            }

            const inventoryPrice = inventory.price * inv.quantity
            totalPrice += inventoryPrice

            await tx.bookingInventory.create({
              data: {
                bookingId: booking.id,
                inventoryId: inv.inventoryId,
                quantity: inv.quantity,
                price: inventory.price, // unit price captured at checkout
              },
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

        if (activeMembership && courtSlots && courtSlots.length > 0) {
          const newRemainingSessions = Math.max(
            0,
            activeMembership.remainingSessions - courtSlots.length,
          )

          await tx.membershipUser.update({
            where: { id: activeMembership.id },
            data: {
              remainingSessions: newRemainingSessions,
              isExpired: newRemainingSessions === 0,
            },
          })

          c.var.logger.info(
            `Deducted ${courtSlots.length} slots from membership ${activeMembership.id}. ` +
              `Remaining: ${newRemainingSessions} sessions`,
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

        // Calculate processing fee (fixed fee + percentage fee + 11% VAT)
        const percentageFee = Math.round(
          totalPrice * (Number(paymentMethod.percentage) / 100),
        )
        const baseFee = paymentMethod.fees + percentageFee
        const vat = Math.round(baseFee * 0.11) // 11% VAT on total fee
        const processingFee = baseFee + vat
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
          },
        })

        // (User details fetched later per-channel when needed)

        // Generate invoice number
        const invoiceNumber = await generateInvoiceNumber()

        // Create invoice
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
            status: PaymentStatus.PENDING,
            dueDate: dayjs().add(15, 'minutes').toDate(), // Payment due in 15 minutes for booking hold
            issuedAt: new Date(),
          },
        })

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

        // --- NEW v3 /payment_requests (mandatory for external payment) ---
        let xenditInvoiceResponse: any = null
        let xenditError: any = null
        if (paymentMethod.channel) {
          if (!env.xendit.apiKey) {
            throw new BadRequestException(
              'Payment gateway unavailable. Please try again later (missing API key).',
            )
          }
          try {
            const channelCode = (paymentMethod as any).channel || ''
            let channelProperties: Record<string, any> = {}
            const userDetails = await tx.user.findUnique({
              where: { id: user.id },
              select: { name: true, email: true, phone: true },
            })

            // Handle credit card payment with 3DS
            if (channelCode === 'CARDS') {
              xenditInvoiceResponse = await handleCreditCardPayment(
                tx,
                paymentMethodId,
                invoiceNumber,
                booking.id,
                user.id,
                finalTotal,
                validated.cardPayment,
              )
            } else if (channelCode === 'MANDIRI_VIRTUAL_ACCOUNT') {
              channelProperties = {
                expires_at: dayjs().add(15, 'minutes').toISOString(),
                display_name: userDetails?.name || 'Customer',
              }
            } else if (channelCode.includes('VIRTUAL_ACCOUNT')) {
              // Other VA channels (BCA, BNI, BRI, etc.) also require display_name
              channelProperties = {
                expires_at: dayjs().add(15, 'minutes').toISOString(),
                display_name: userDetails?.name || 'Customer',
              }
            } else if (channelCode === 'QRIS' || channelCode === 'QR') {
              channelProperties = {
                expires_at: dayjs().add(15, 'minutes').toISOString(),
              }
            } else if (
              channelCode.includes('EWALLET') ||
              ['DANA', 'OVO', 'LINKAJA', 'SHOPEEPAY'].includes(channelCode)
            ) {
              channelProperties = {
                success_return_url: `${env.frontEndUrl}/payment/success?invoice_id=${invoice.id}`,
                failure_return_url: `${env.frontEndUrl}/payment/failed?invoice_id=${invoice.id}`,
              }
            } else {
              channelProperties = {
                expires_at: dayjs().add(15, 'minutes').toISOString(),
              }
            }

            // Skip payment request creation for credit card (already handled above)
            if (channelCode !== 'CARDS') {
              c.var.logger.info(
                `Creating Xendit payment request channel=${channelCode} amount=${finalTotal}`,
              )
              xenditInvoiceResponse =
                await xenditService.createPaymentRequestV3({
                  referenceId: invoiceNumber,
                  requestAmount: finalTotal,
                  country: 'ID',
                  currency: 'IDR',
                  captureMethod: 'AUTOMATIC',
                  channelCode,
                  channelProperties,
                  description: `Payment for booking ${booking.id}`,
                  metadata: {
                    bookingId: booking.id,
                    userId: user.id,
                    invoiceNumber: invoice.number,
                  },
                })
            }
          } catch (errX: any) {
            const errMsg = errX?.message || 'Payment gateway error'
            xenditError = {
              message: errMsg,
              code:
                errMsg.includes('IP allowlist') || errMsg.includes('allowlist')
                  ? 'XENDIT_IP_NOT_ALLOWLIST'
                  : errMsg.includes('channel_properties')
                    ? 'XENDIT_CHANNEL_PROPERTIES_INVALID'
                    : errMsg.includes('below the minimum limit') ||
                        errMsg.includes('minimum amount')
                      ? 'XENDIT_AMOUNT_TOO_LOW'
                      : errMsg.includes('tokenize') || errMsg.includes('card')
                        ? 'XENDIT_CARD_ERROR'
                        : 'XENDIT_ERROR',
            }
            c.var.logger.error(
              `Xendit error: ${xenditError.code} - ${xenditError.message}`,
            )
          }
          if (!xenditInvoiceResponse) {
            // Provide user-friendly error messages based on error code
            let userMessage = xenditError?.message || 'Payment gateway error'
            if (xenditError?.code === 'XENDIT_AMOUNT_TOO_LOW') {
              userMessage = `Payment amount (Rp ${finalTotal.toLocaleString('id-ID')}) is below the minimum limit required by the payment method. Please add more items or choose a different payment method.`
            } else if (xenditError?.code === 'XENDIT_IP_NOT_ALLOWLIST') {
              userMessage =
                'Payment gateway configuration error. Please contact support.'
            } else if (
              xenditError?.code === 'XENDIT_CHANNEL_PROPERTIES_INVALID'
            ) {
              userMessage =
                'Payment method configuration error. Please try a different payment method or contact support.'
            } else if (xenditError?.code === 'XENDIT_CARD_ERROR') {
              userMessage =
                'Card processing failed. Please check your card details and try again. If the problem persists, contact support.'
            }

            throw new BadRequestException(
              `Unable to initialize payment. ${userMessage}`,
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
            dueDate: dayjs().add(15, 'minutes').toDate(),
            externalRef:
              xenditInvoiceResponse?.id ||
              xenditInvoiceResponse?.payment_session_id ||
              null,
            // Store payment session or payment request metadata
            meta: xenditInvoiceResponse
              ? // For CARDS: Store payment session metadata
                xenditInvoiceResponse.payment_session_id
                ? {
                    payment_session_id:
                      xenditInvoiceResponse.payment_session_id,
                    reference_id: xenditInvoiceResponse.reference_id,
                    session_type: xenditInvoiceResponse.session_type,
                    status: xenditInvoiceResponse.status,
                    amount: xenditInvoiceResponse.amount,
                    currency: xenditInvoiceResponse.currency,
                    created: xenditInvoiceResponse.created,
                  }
                : // For other channels: Store payment request metadata
                  {
                    payment_request_id:
                      xenditInvoiceResponse.payment_request_id,
                    reference_id: xenditInvoiceResponse.reference_id,
                    status: xenditInvoiceResponse.status,
                    channel_code: xenditInvoiceResponse.channel_code,
                    channel_properties:
                      xenditInvoiceResponse.channel_properties,
                    actions: xenditInvoiceResponse.actions,
                    request_amount: xenditInvoiceResponse.request_amount,
                    currency: xenditInvoiceResponse.currency,
                    created: xenditInvoiceResponse.created,
                  }
              : undefined,
          },
        })

        // Link payment to invoice
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paymentId: payment.id },
        })

        // Admin notification about new booking (non-blocking)
        try {
          await notificationService.createBookingAdminNotification(
            booking.id,
            invoice.number,
          )
        } catch (e) {
          c.var.logger.warn(`Failed to create booking admin notification: ${e}`)
        }

        // Set hold expiry (15 minutes for all payment methods)
        const holdExpiresAt = dayjs().add(15, 'minutes').toDate()

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
            paymentStatus: result.xenditPaymentRequest?.status || 'PENDING',
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

      // Call Xendit API to cancel the payment session
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
