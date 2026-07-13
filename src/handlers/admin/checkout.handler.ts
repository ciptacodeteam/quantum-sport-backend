import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { isSlotAllowedForMembershipType } from '@/lib/membership-hours'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { generateInvoiceNumber, formatPhone } from '@/lib/utils'
import { assertCoachSlotsDoNotConflict } from '@/services/coach-booking-conflict.service'
import { getInventoryAvailabilityMap } from '@/services/inventory-availability.service'
import { zValidator } from '@hono/zod-validator'
import {
  BookingStatus,
  CoachType,
  CourtSport,
  PaymentStatus,
  SlotType,
  UserSource,
} from '@prisma/client'
import type { Membership, MembershipUser } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'
import { hashPassword } from '@/lib/password'

const adminCheckoutSchema = z
  .object({
    userId: z.string().optional(),
    name: z.string().min(1).optional(),
    phone: z.string().min(5).optional(),
    totalHours: z.number().positive(),
    courtSlots: z.array(z.string()).optional(),
    coachSlots: z.array(z.string()).optional(),
    // Optional description for coach booking – e.g. names of up to 4 members
    coachDescription: z.string().max(500).optional(),
    adminNote: z.string().max(1000).optional(),
    useMembership: z.boolean().optional().default(true),
    ballboySlots: z
      .array(
        z.union([
          z.string(),
          z.object({
            slotId: z.string(),
            courtSlotId: z.string(),
          }),
        ]),
      )
      .optional(),
    inventories: z
      .array(
        z.object({
          inventoryId: z.string(),
          quantity: z.number().int().positive(),
        }),
      )
      .optional(),
  })
  .refine(
    (data) => {
      // Must provide either userId or (name and phone)
      return !!data.userId || (!!data.name && !!data.phone)
    },
    {
      message:
        'Provide either userId or both name and phone for a new customer',
      path: ['userId'],
    },
  )

type AdminCheckoutSchema = z.infer<typeof adminCheckoutSchema>

function uniqueSlotIds(slotIds: string[] | undefined): string[] | undefined {
  return slotIds ? Array.from(new Set(slotIds)) : slotIds
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
    const slotId = typeof item === 'string' ? item : item.slotId
    const courtSlotId = typeof item === 'string' ? undefined : item.courtSlotId
    uniqueSelections.set(
      `${slotId}|${courtSlotId ?? ''}`,
      courtSlotId ? { slotId, courtSlotId } : { slotId },
    )
  }

  return Array.from(uniqueSelections.values())
}

function ballboyCoversCourtSlot(
  ballboySlot: { startAt: Date; endAt: Date },
  courtSlot: { startAt: Date; endAt: Date },
): boolean {
  return (
    dayjs(ballboySlot.startAt).valueOf() <= dayjs(courtSlot.startAt).valueOf() &&
    dayjs(ballboySlot.endAt).valueOf() >= dayjs(courtSlot.endAt).valueOf()
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

export const adminCheckoutHandler = factory.createHandlers(
  zValidator('json', adminCheckoutSchema, validateHook),
  async (c) => {
    const {
      userId: inputUserId,
      name,
      phone,
      totalHours,
      courtSlots: rawCourtSlots,
      coachSlots: rawCoachSlots,
      coachDescription,
      adminNote,
      useMembership,
      ballboySlots: rawBallboySlots,
      inventories,
    } = c.req.valid('json') as AdminCheckoutSchema
    const courtSlots = uniqueSlotIds(rawCourtSlots)
    const coachSlots = uniqueSlotIds(rawCoachSlots)
    const ballboySelections = normalizeBallboySelections(rawBallboySlots)
    const ballboySlots = Array.from(
      new Set(ballboySelections.map((selection) => selection.slotId)),
    )

    // Get the admin (cashier) creating this booking
    const admin = c.get('admin')
    const cashierId = admin?.id || null

    // Ensure at least one item is provided
    const hasItems =
      (courtSlots && courtSlots.length > 0) ||
      (coachSlots && coachSlots.length > 0) ||
      (ballboySlots && ballboySlots.length > 0) ||
      (inventories && inventories.length > 0)
    if (!hasItems) {
      return c.json(
        {
          success: false,
          message: 'At least one slot or inventory must be provided',
          data: null,
        },
        status.BAD_REQUEST,
      )
    }

    try {
      const result = await db.$transaction(async (tx) => {
        // Resolve or create user
        let resolvedUserId = inputUserId
        if (!resolvedUserId) {
          const formattedPhone = await formatPhone(phone!)
          // Try find by phone
          const existingByPhone = await tx.user.findUnique({
            where: { phone: formattedPhone },
            select: { id: true },
          })
          if (existingByPhone) {
            resolvedUserId = existingByPhone.id
          } else {
            // Create new user with password set to phone number
            const hashed = await hashPassword(formattedPhone)
            const created = await tx.user.create({
              data: {
                name: name!,
                phone: formattedPhone,
                password: hashed,
                source: UserSource.WALK_IN,
              },
              select: { id: true },
            })
            resolvedUserId = created.id
          }
        } else {
          // Validate provided userId exists
          const user = await tx.user.findUnique({
            where: { id: resolvedUserId },
            select: { id: true },
          })
          if (!user) {
            throw new NotFoundException('User not found')
          }
        }

        let courtSportForMembership: CourtSport | null = null
        if (courtSlots && courtSlots.length > 0) {
          const courtSlotSports = await tx.slot.findMany({
            where: {
              id: { in: courtSlots },
              type: SlotType.COURT,
            },
            select: {
              court: {
                select: {
                  sport: true,
                },
              },
            },
          })
          const sports = Array.from(
            new Set(courtSlotSports.map((slot) => slot.court?.sport).filter(Boolean)),
          ) as CourtSport[]

          if (sports.length > 1) {
            throw new BadRequestException(
              'Cannot use one membership for mixed padel and tennis court slots',
            )
          }

          courtSportForMembership = sports[0] ?? null
        }

        // Check for active membership BEFORE calculating prices
        // This determines if court costs should be excluded from totalPrice
        let activeMembership: (MembershipUser & { membership: Membership }) | null = null
        let activeMembershipCandidates: Array<
          MembershipUser & { membership: Membership }
        > = []
        if (useMembership && totalHours > 0 && courtSportForMembership) {
          const now = new Date()
          activeMembershipCandidates = await tx.membershipUser.findMany({
            where: {
              userId: resolvedUserId!,
              isExpired: false,
              isSuspended: false,
              startDate: { lte: now }, // Membership must have started
              endDate: { gt: now }, // Membership must not have expired
              remainingSessions: { gte: totalHours }, // Must have enough sessions
              membership: {
                sport: courtSportForMembership,
              },
            },
            include: {
              membership: true,
            },
            orderBy: {
              endDate: 'asc', // Use membership that expires first
            },
          })
        }

        // Create booking in CONFIRMED state (admin bypasses payment)
        const booking = await tx.booking.create({
          data: {
            userId: resolvedUserId!,
            status: BookingStatus.CONFIRMED,
            totalPrice: 0,
            processingFee: 0,
            holdExpiresAt: null,
            adminNote: adminNote?.trim() || null,
            ...(cashierId && { cashierId }),
          },
        })

        let totalPrice = 0
        let courtNormalPrice = 0
        let courtDiscountPrice = 0
        let courtCostCoveredByMembership = 0 // Track court costs covered by membership
        let selectedCourtSlots: Array<{
          id: string
          startAt: Date
          endAt: Date
          court?: { sport: CourtSport } | null
        }> = []
        const bookedItems = {
          courtSlots: [] as string[],
          coachSlots: [] as string[],
          ballboySlots: [] as string[],
          inventories: [] as Array<{ inventoryId: string; quantity: number }>,
        }

        // Courts
        if (courtSlots && courtSlots.length > 0) {
          const slotData = await tx.slot.findMany({
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
          if (slotData.length !== courtSlots.length) {
            throw new BadRequestException(
              'One or more court slots not found or unavailable',
            )
          }
          selectedCourtSlots = slotData
          activeMembership =
            activeMembershipCandidates.find((candidate) =>
              slotData.every((slot) =>
                isSlotAllowedForMembershipType(candidate.membership.type, slot.startAt),
              ),
            ) ?? null

          // If the user's package does not match these slot hours, continue as a normal paid booking.
          for (const slot of slotData) {
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
            courtNormalPrice += normalPrice
            courtDiscountPrice += discountedPrice

            // If membership covers this booking, exclude court costs from totalPrice
            // but still track the original price
            if (activeMembership) {
              courtCostCoveredByMembership += normalPrice
              // Don't add to totalPrice - membership covers it
            } else {
              totalPrice += discountedPrice
            }

            await tx.bookingDetail.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                price: normalPrice,
                discountPrice: discountedPrice,
                courtId: slot.courtId || undefined,
              },
            })
            bookedItems.courtSlots.push(slot.id)
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

        // Coaches
        if (coachSlots && coachSlots.length > 0) {
          c.var.logger.info(
            `Processing ${coachSlots.length} coach slots: ${coachSlots.join(', ')}`,
          )
          const slotData = await tx.slot.findMany({
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
          if (slotData.length !== coachSlots.length) {
            c.var.logger.warn(
              `Coach slots mismatch: requested ${coachSlots.length}, found ${slotData.length}. ` +
                `Requested IDs: ${coachSlots.join(', ')}. ` +
                `Found IDs: ${slotData.map((s) => s.id).join(', ')}`,
            )
            throw new BadRequestException(
              'One or more coach slots not found or unavailable',
            )
          }
          if (courtSportForMembership) {
            const allowedCoachTypes =
              courtSportForMembership === CourtSport.PADEL
                ? [CoachType.PADEL, CoachType.PADEL_TENNIS]
                : [CoachType.TENNIS, CoachType.PADEL_TENNIS]
            if (
              slotData.some(
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
            await assertCoachSlotsDoNotConflict(tx, slotData)
          } catch (error) {
            throw new BadRequestException(
              error instanceof Error
                ? error.message
                : 'Coach schedule conflicts with another booking',
            )
          }
          // Use a generic coach type; if none exists, create a default one.
          let defaultCoachType = await tx.bookingCoachType.findFirst()
          if (!defaultCoachType) {
            defaultCoachType = await tx.bookingCoachType.create({
              data: {
                name: 'Default',
                description:
                  'Auto-created default coach type for admin checkout',
              },
            })
          }
          for (const slot of slotData) {
            if (slot.bookingCoaches.length > 0) {
              throw new BadRequestException(
                'One or more coach slots are already booked',
              )
            }
            totalPrice += slot.price
            await tx.bookingCoach.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                bookingCoachTypeId: defaultCoachType.id,
                // Store names of members joining this coach session (if provided)
                description: coachDescription?.trim() || undefined,
                price: slot.price,
              },
            })
            bookedItems.coachSlots.push(slot.id)
            c.var.logger.info(
              `Coach slot ${slot.id} booked successfully. Price: ${slot.price}`,
            )
          }
          c.var.logger.info(
            `Total coach slots booked: ${bookedItems.coachSlots.length}. Total coach price: ${slotData.reduce((sum, s) => sum + s.price, 0)}`,
          )
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

        // Ballboys
        if (ballboySlots && ballboySlots.length > 0) {
          const slotData = await tx.slot.findMany({
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
          if (slotData.length !== ballboySlots.length) {
            throw new BadRequestException(
              'One or more ballboy slots not found or unavailable',
            )
          }
          validateBallboysForTennisCourts(
            ballboySelections,
            slotData,
            selectedCourtSlots,
          )
          for (const slot of slotData) {
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
            bookedItems.ballboySlots.push(slot.id)
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

        // Inventories
        if (inventories && inventories.length > 0) {
          const inventoryAvailabilityById =
            selectedCourtSlots.length > 0
              ? await getInventoryAvailabilityMap(tx, {
                  courtSport: courtSportForMembership ?? undefined,
                  startAt: dayjs(
                    Math.min(
                      ...selectedCourtSlots.map((slot) =>
                        dayjs(slot.startAt).valueOf(),
                      ),
                    ),
                  ).toISOString(),
                  endAt: dayjs(
                    Math.max(
                      ...selectedCourtSlots.map((slot) =>
                        dayjs(slot.endAt).valueOf(),
                      ),
                    ),
                  ).toISOString(),
                })
              : null

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
            if (courtSportForMembership && inventory.sport !== courtSportForMembership) {
              throw new BadRequestException(
                `Inventory ${inventory.name} does not match the selected court sport`,
              )
            }
            const availableQuantity =
              inventoryAvailabilityById?.get(inv.inventoryId)?.availableQuantity ??
              inventory.quantity
            if (availableQuantity < inv.quantity) {
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
                quantity: inv.quantity,
                price: inventory.price,
              },
            })
            bookedItems.inventories.push({
              inventoryId: inv.inventoryId,
              quantity: inv.quantity,
            })
            // Decrement inventory stock
            await tx.inventory.update({
              where: { id: inv.inventoryId },
              data: {
                quantity: { decrement: inv.quantity },
              },
            })
          }
        }

        // Deduct totalHours from user's active membership sessions
        // (Membership was already checked earlier if it exists)
        if (activeMembership && totalHours > 0) {
          const newRemainingSessions = Math.max(
            0,
            activeMembership.remainingSessions - totalHours,
          )

          await tx.membershipUser.update({
            where: { id: activeMembership.id },
            data: {
              remainingSessions: newRemainingSessions,
              // Mark as expired if no sessions left
              isExpired: newRemainingSessions === 0,
            },
          })

          // Log for tracking
          c.var.logger.info(
            `Deducted ${totalHours} hours from membership ${activeMembership.id}. ` +
              `Court cost covered: ${courtCostCoveredByMembership}. ` +
              `Remaining: ${newRemainingSessions} sessions`,
          )
        } else if (totalHours > 0) {
          // No active membership with available sessions
          c.var.logger.warn(
            `User ${resolvedUserId} has no active membership with available sessions for ${totalHours} hours`,
          )
        }

        // Update totals on booking
        // (totalPrice already excludes court costs if covered by membership)
        const processingFee = 0
        if (activeMembership) {
          courtNormalPrice = 0
          courtDiscountPrice = 0
        }
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            totalPrice,
            processingFee,
            courtNormalPrice,
            courtDiscountPrice,
            membershipUserId: activeMembership?.id,
            membershipSessionsUsed: activeMembership ? totalHours : 0,
          },
        })

        // Generate invoice (marked as PAID immediately)
        const invoiceNumber = await generateInvoiceNumber()
        const invoice = await tx.invoice.create({
          data: {
            userId: resolvedUserId!,
            bookingId: booking.id,
            number: invoiceNumber,
            subtotal: totalPrice,
            processingFee,
            total: totalPrice + processingFee,
            status: PaymentStatus.PAID,
            dueDate: dayjs().add(5, 'minutes').toDate(),
            issuedAt: new Date(),
            paidAt: new Date(),
          },
        })

        return {
          bookingId: booking.id,
          invoiceId: invoice.id,
          totalPrice,
          processingFee,
          totalHours,
          bookedItems,
        }
      })

      return c.json(
        ok(
          {
            bookingId: result.bookingId,
            invoiceId: result.invoiceId,
            totalPrice: result.totalPrice,
            processingFee: result.processingFee,
            totalHours: result.totalHours,
            status: BookingStatus.CONFIRMED,
            paymentStatus: PaymentStatus.PAID,
            bookedItems: result.bookedItems,
          },
          'Admin checkout successful (payment bypassed)',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error during admin checkout: ${error}`)
      throw error
    }
  },
)
