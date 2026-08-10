import { USER_PROFILE_SUBDIR } from '@/config'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { formatPhone } from '@/lib/utils'
import {
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
  UpdateUserSchema,
  updateUserSchema,
} from '@/lib/validation'
import {
  buildPasswordResetLink,
  createPasswordResetToken,
} from '@/services/password-reset.service'
import { deleteFile, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import dayjs from 'dayjs'
import status from 'http-status'
import z from 'zod'
import { env } from '@/env'

// Validation schema for customer search (Select2)
const customerSearchSchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters'),
  limit: z.string().optional().default('20'),
})

type CustomerSearchSchema = z.infer<typeof customerSearchSchema>

// Validation schema for ban user
const banUserSchema = z.object({
  reason: z.string().min(1).max(500),
  banExpires: z
    .string()
    .optional()
    .refine((val) => !val || dayjs(val).isValid(), {
      message: 'Invalid date format',
    }),
})

type BanUserSchema = z.infer<typeof banUserSchema>

// Helper function to normalize phone search query
// Handles different phone formats: "081", "6281", "+6281" all match "+6281..."
function normalizePhoneSearch(query: string): string[] {
  const cleaned = query.replace(/[\s\-()]/g, '')
  const patterns: string[] = [cleaned] // Always include original query

  // If starts with "08", convert to international format
  // "081234" -> should match "+6281234..."
  if (cleaned.startsWith('08')) {
    // Remove the leading "0" and add country code variations
    const withoutZero = cleaned.slice(1) // "81234"
    patterns.push(`+62${withoutZero}`) // "+6281234"
    patterns.push(`62${withoutZero}`) // "6281234"
  }
  // If starts with "62" (without +)
  else if (cleaned.startsWith('62') && !cleaned.startsWith('+62')) {
    patterns.push(`+${cleaned}`) // "+62..."
    // Also add "08" version
    if (cleaned.length > 2 && cleaned[2] === '8') {
      patterns.push(`0${cleaned.slice(2)}`) // "08..."
    }
  }
  // If starts with "+62"
  else if (cleaned.startsWith('+62')) {
    const withoutPlus = cleaned.slice(1) // "62..."
    patterns.push(withoutPlus) // "62..."
    // Also add "08" version
    if (cleaned.length > 3 && cleaned[3] === '8') {
      patterns.push(`0${cleaned.slice(3)}`) // "08..."
    }
  }
  // If starts with just "8" (like "8123")
  else if (cleaned.startsWith('8') && /^\d+$/.test(cleaned)) {
    patterns.push(`+62${cleaned}`) // "+628..."
    patterns.push(`62${cleaned}`) // "628..."
    patterns.push(`0${cleaned}`) // "08..."
  }
  // For any numeric query starting with digits, try common formats
  else if (/^\d+$/.test(cleaned) && cleaned.length >= 2) {
    patterns.push(`+62${cleaned}`)
    patterns.push(`62${cleaned}`)
    if (cleaned.startsWith('8')) {
      patterns.push(`0${cleaned}`)
    }
  }

  return [...new Set(patterns.filter((p) => p.length > 0))] // Remove duplicates and empty strings
}

// GET /admin/customers/search
// Search customers for Select2 component with membership details
export const searchCustomersHandler = factory.createHandlers(
  zValidator('query', customerSearchSchema, validateHook),
  async (c) => {
    try {
      const { q, limit } = c.req.valid('query') as CustomerSearchSchema
      const takeLimit = parseInt(limit) || 20

      // Normalize phone search patterns
      const phonePatterns = normalizePhoneSearch(q)

      // Build case-insensitive search across name, email, and phone
      const users = await db.user.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            // Search phone with multiple patterns
            ...phonePatterns.map((pattern) => ({
              phone: { contains: pattern, mode: 'insensitive' as const },
            })),
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
        take: takeLimit,
        orderBy: { name: 'asc' },
      })

      // Get active memberships for all users in a single query
      const userIds = users.map((u) => u.id)
      const now = new Date()
      const activeMemberships = await db.membershipUser.findMany({
        where: {
          userId: { in: userIds },
          isExpired: false,
          isSuspended: false,
          startDate: { lte: now }, // Membership must have started
          endDate: { gt: now }, // Membership must not have expired
        },
        include: {
          membership: {
            select: {
              id: true,
              name: true,
              price: true,
              sport: true,
              type: true,
            },
          },
        },
        orderBy: {
          endDate: 'asc', // Get the one that expires first
        },
      })

      // Group memberships by userId and get the first one (earliest endDate)
      const membershipMap = new Map<string, (typeof activeMemberships)[0]>()
      for (const membership of activeMemberships) {
        if (!membershipMap.has(membership.userId)) {
          membershipMap.set(membership.userId, membership)
        }
      }

      // Combine users with their active memberships
      // Note: Every user will have activeMembership field - either with data or null
      const usersWithMembership = users.map((user) => {
        const activeMembership = membershipMap.get(user.id)

        return {
          ...user,
          activeMembership: activeMembership
            ? {
                id: activeMembership.id,
                startDate: activeMembership.startDate,
                endDate: activeMembership.endDate,
                remainingSessions: activeMembership.remainingSessions,
                remainingDuration: activeMembership.remainingDuration,
                isExpired: activeMembership.isExpired,
                isSuspended: activeMembership.isSuspended,
                membership: {
                  id: activeMembership.membership.id,
                  name: activeMembership.membership.name,
                  price: activeMembership.membership.price,
                  sport: activeMembership.membership.sport,
                  type: activeMembership.membership.type,
                },
              }
            : null, // Always include activeMembership field, set to null if no active membership
        }
      })

      return c.json(ok(usersWithMembership), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in searchCustomersHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/users
// Get all users
export const getAllUsersHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'email', 'phone'],
      })

      const users = await db.user.findMany({
        ...queryOptions,
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          phone: true,
          phoneVerified: true,
          source: true,
          image: true,
          banned: true,
          banReason: true,
          banExpires: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              bookings: true,
              classBookings: true,
              membershipUser: true,
              invoice: true,
            },
          },
        },
      })

      return c.json(ok(users), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllUsersHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/users/:id
// Get user detail
export const getUserDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const user = await db.user.findUnique({
        where: { id },
        include: {
          bookings: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              createdAt: true,
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
          classBookings: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              createdAt: true,
              class: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
          membershipUser: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              isExpired: true,
              isSuspended: true,
              createdAt: true,
              membership: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
          invoice: {
            select: {
              id: true,
              number: true,
              status: true,
              total: true,
              paidAt: true,
              issuedAt: true,
            },
            take: 10,
            orderBy: { issuedAt: 'desc' },
          },
          clubsLed: {
            select: {
              id: true,
              name: true,
              isActive: true,
              createdAt: true,
            },
          },
          clubMember: {
            select: {
              id: true,
              joinedAt: true,
              isActive: true,
              club: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      return c.json(ok(user), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getUserDetailHandler: ${error}`)
      throw error
    }
  },
)

export const updateUserHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateUserSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const { email, image, name, phone } = c.req.valid(
        'form',
      ) as UpdateUserSchema

      const user = await db.user.findUnique({
        where: { id },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      let formattedPhone: string | undefined = user.phone

      if (phone) {
        formattedPhone = await formatPhone(phone)
      }

      let imageUrl: string | null = user.image

      if (image) {
        if (imageUrl) {
          const deleted = await deleteFile(imageUrl)
          if (deleted) {
            c.var.logger.info(`Image deleted for user ID: ${user.id}`)
          } else {
            c.var.logger.warn(`Failed to delete image for user ID: ${user.id}`)
          }
        }

        const uploaded = await uploadFile(image, {
          subdir: USER_PROFILE_SUBDIR,
        })

        imageUrl = uploaded.relativePath
      }

      const updatedUser = await db.user.update({
        where: { id },
        data: {
          phone: formattedPhone,
          name,
          email,
          image: imageUrl,
        },
      })

      return c.json(ok(updatedUser, 'User updated successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateUserHandler: ${error}`)
      throw error
    }
  },
)

// POST /admin/users/:id/send-reset-password
// Send reset password link via email or phone
export const sendResetPasswordLinkHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const user = await db.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          phone: true,
          phoneVerified: true,
        },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      // Validate user has at least email or phone
      if (!user.email && !user.phone) {
        throw new BadRequestException(
          'User has no email or phone number on file',
        )
      }

      // Create password reset token
      const { token, expiresIn, expiresAt } = await createPasswordResetToken(
        user.id,
      )
      const resetLink = buildPasswordResetLink(token, env.frontEndUrl)

      // Track which channel was used
      const channels: string[] = []

      // Priority 1: Send to email if available and verified
      if (user.email && user.emailVerified) {
        try {
          const { queueEmail } = await import('@/services/email-queue.service')

          await queueEmail({
            to: user.email,
            subject: 'Reset Your Password',
            template: 'passwordReset',
            variables: {
              name: user.name,
              resetLink,
              expiresIn,
              actionUrl: resetLink,
            },
          })
          channels.push('email')
          c.var.logger.info(
            { userId: user.id, email: user.email },
            'Password reset email queued',
          )
        } catch (emailError) {
          c.var.logger.error(
            { userId: user.id, error: emailError },
            'Failed to queue password reset email',
          )
          // Continue to phone fallback if email fails
        }
      }

      channels.push('manual')

      return c.json(
        ok(
          {
            userId: user.id,
            channels,
            resetLink,
            message: channels.includes('manual')
              ? 'Password reset link created for manual sharing'
              : `Password reset link sent successfully via ${channels.join(' and ')}`,
            sentTo: {
              email: channels.includes('email') ? user.email : null,
              phone: null,
            },
            expiresAt,
          },
          channels.includes('manual')
            ? 'Reset password link created'
            : `Reset password link sent via ${channels.join(' and ')}`,
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.error(`Error in sendResetPasswordLinkHandler: ${error}`)
      throw error
    }
  },
)

export const verifyUserPhoneManuallyHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const user = await db.user.findUnique({
        where: { id },
        select: {
          id: true,
          phone: true,
          phoneVerified: true,
        },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      if (!user.phone) {
        throw new BadRequestException('User has no phone number on file')
      }

      if (user.phoneVerified) {
        return c.json(
          ok(user, 'WhatsApp number is already verified'),
          status.OK,
        )
      }

      const updatedUser = await db.user.update({
        where: { id },
        data: {
          phoneVerified: true,
        },
      })

      return c.json(
        ok(updatedUser, 'WhatsApp number verified manually'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in verifyUserPhoneManuallyHandler: ${error}`)
      throw error
    }
  },
)

// POST /admin/users/:id/send-change-phone
// Send change phone OTP link
/**
 * !important
 * Salah Implement
 */
// export const sendChangePhoneLinkHandler = factory.createHandlers(
//   zValidator('param', idSchema, validateHook),
//   async (c) => {
//     try {
//       const { id } = c.req.valid('param') as IdSchema

//       const user = await db.user.findUnique({
//         where: { id },
//       })

//       if (!user) {
//         throw new NotFoundException('User not found')
//       }

//       if (!user.phone) {
//         throw new BadRequestException('User does not have a phone number')
//       }

//       let code = DEFAULT_OTP_CODE
//       let requestId = Math.random().toString(36).substring(2, 30)

//       if (env.nodeEnv === 'production') {
//         code = await generateOtp(OTP_LENGTH)
//         requestId = await sendPhoneOtp(user.phone, code)

//         if (!requestId) {
//           c.var.logger.error(
//             `Failed to find OTP request ID for phone ${user.phone}`,
//           )
//           throw new Error('Failed to send OTP')
//         }
//       }

//       await db.phoneVerification.upsert({
//         where: { phone: user.phone },
//         update: {
//           requestId,
//           code,
//           isUsed: false,
//           type: PhoneVerificationType.CHANGE_PHONE,
//           expiresAt: dayjs().add(5, 'minute').toDate(),
//         },
//         create: {
//           requestId,
//           phone: user.phone,
//           code,
//           isUsed: false,
//           type: PhoneVerificationType.CHANGE_PHONE,
//           expiresAt: dayjs().add(5, 'minute').toDate(),
//         },
//       })

//       return c.json(
//         ok(
//           {
//             userId: user.id,
//             phone: user.phone,
//             requestId,
//             message:
//               env.nodeEnv === 'production'
//                 ? 'OTP sent successfully to user phone'
//                 : `OTP code: ${code} (development mode)`,
//           },
//           'Change phone OTP sent successfully',
//         ),
//         status.OK,
//       )
//     } catch (error) {
//       c.var.logger.fatal(`Error in sendChangePhoneLinkHandler: ${error}`)
//       throw error
//     }
//   },
// )

// PUT /admin/users/:id/ban
// Ban user
export const banUserHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', banUserSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const banData = c.req.valid('json') as BanUserSchema

      const user = await db.user.findUnique({
        where: { id },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      if (user.banned) {
        throw new BadRequestException('User is already banned')
      }

      const updatedUser = await db.user.update({
        where: { id },
        data: {
          banned: true,
          banReason: banData.reason,
          banExpires: banData.banExpires
            ? dayjs(banData.banExpires).toDate()
            : null,
        },
      })

      await db.authToken.deleteMany({
        where: { userId: id },
      })

      return c.json(
        ok(
          updatedUser,
          `User banned successfully${banData.banExpires ? ` until ${banData.banExpires}` : ' permanently'}`,
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in banUserHandler: ${error}`)
      throw error
    }
  },
)

// PUT /admin/users/:id/unban
// Unban user
export const unbanUserHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const user = await db.user.findUnique({
        where: { id },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      if (!user.banned) {
        throw new BadRequestException('User is not banned')
      }

      const updatedUser = await db.user.update({
        where: { id },
        data: {
          banned: false,
          banReason: null,
          banExpires: null,
        },
      })

      return c.json(ok(updatedUser, 'User unbanned successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in unbanUserHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/customers/:id/membership
// Get customer details with active membership for checkout
export const getCustomerMembershipDetailsHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const user = await db.user.findUnique({
        where: { id },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      // Find active membership
      const now = new Date()
      const activeMembership = await db.membershipUser.findFirst({
        where: {
          userId: id,
          isExpired: false,
          isSuspended: false,
          startDate: { lte: now }, // Membership must have started
          endDate: { gt: now }, // Membership must not have expired
        },
        orderBy: {
          endDate: 'asc', // Get the one that expires first
        },
        include: {
          membership: {
            select: {
              id: true,
              name: true,
              price: true,
              sport: true,
              type: true,
            },
          },
        },
      })

      return c.json(
        ok({
          customer: user.id,
          activeMembership: activeMembership
            ? {
                id: activeMembership.id,
                startDate: activeMembership.startDate,
                endDate: activeMembership.endDate,
                remainingSessions: activeMembership.remainingSessions,
                remainingDuration: activeMembership.remainingDuration,
                isExpired: activeMembership.isExpired,
                isSuspended: activeMembership.isSuspended,
                membership: {
                  id: activeMembership.membership.id,
                  name: activeMembership.membership.name,
                  price: activeMembership.membership.price,
                  sport: activeMembership.membership.sport,
                  type: activeMembership.membership.type,
                },
              }
            : null,
        }),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in getCustomerMembershipDetailsHandler: ${error}`,
      )
      throw error
    }
  },
)
