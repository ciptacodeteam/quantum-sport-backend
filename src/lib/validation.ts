import { DEFAULT_DATE_FORMAT } from '@/config'
import { CourtSport, Gender, MembershipType } from '@prisma/client'
import dayjs from 'dayjs'
import z from 'zod'

export const idSchema = z.object({
  id: z.string(),
})

export type IdSchema = z.infer<typeof idSchema>

export const phoneSchema = z.object({
  phone: z.string().min(10).max(15),
})

export type PhoneSchema = z.infer<typeof phoneSchema>

export const authTokenCookieSchema = z.object({
  token: z.string().min(10).describe('Access token'),
  refreshToken: z.string().min(10).describe('Refresh token'),
})

export const verifyOtpSchema = z.object({
  phone: z.string().min(10).max(15),
  code: z.string().length(4),
  requestId: z.string(),
})

export type VerifyOtpSchema = z.infer<typeof verifyOtpSchema>

export const loginSchema = phoneSchema.extend({
  phone: z.string().min(10).max(15),
  password: z.string().min(6).max(100),
})

export type LoginSchema = z.infer<typeof loginSchema>

export const registerSchema = phoneSchema.extend({
  name: z.string().min(3).max(100),
  code: z.string().length(4),
  requestId: z.string(),
  password: z.string().min(6).max(100),
})

export type RegisterSchema = z.infer<typeof registerSchema>

export const tokenSchema = z.object({
  token: z.string().min(10),
})

export const refreshTokenSchema = tokenSchema

export const forgotPasswordSchema = phoneSchema

export type ForgotPasswordSchema = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
  phone: z.string().min(10).max(15),
  requestId: z.string(),
  newPassword: z.string().min(6).max(100),
})

export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>

export const loginWithEmailSchema = z.object({
  email: z.email().min(5).max(100),
  password: z.string().min(6).max(100),
})

export type LoginWithEmailSchema = z.infer<typeof loginWithEmailSchema>

export const registerAdminSchema = loginWithEmailSchema
  .extend({
    name: z.string().min(3).max(100),
    email: z.email().min(5).max(100),
    password: z.string().min(6).max(100),
    confirmPassword: z.string().min(6).max(100),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
  })

export type RegisterAdminSchema = z.infer<typeof registerAdminSchema>

export const updateAdminProfileSchema = z.object({
  name: z.string().min(3).max(100),
  phone: z.string().min(10).max(15).optional(),
  email: z.email().min(5).max(100).optional(),
  image: z.file().optional(),
})

export type UpdateAdminProfileSchema = z.infer<typeof updateAdminProfileSchema>

const formBooleanSchema = z.preprocess((value) => {
  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true
  }

  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false
  }

  return value
}, z.boolean())

export const createInventorySchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  image: z.file().optional(),
  sport: z.nativeEnum(CourtSport).optional().default(CourtSport.PADEL),
  quantity: z.coerce.number().min(0),
  price: z.coerce.number().min(0),
  isActive: formBooleanSchema.optional().default(true),
})

export type CreateInventorySchema = z.infer<typeof createInventorySchema>

export const updateInventorySchema = createInventorySchema.partial()

export type UpdateInventorySchema = z.infer<typeof updateInventorySchema>

export const searchQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  sortBy: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export type SearchQuerySchema = z.infer<typeof searchQuerySchema>

const staffBaseSchema = z.object({
  name: z.string().min(3).max(100),
  email: z.email().min(5).max(100),
  phone: z.string().min(10).max(15),
  password: z.string().min(6).max(100),
  confirmPassword: z.string().min(6).max(100),
  joinedAt: z
    .string()
    .refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
      message: 'Invalid date format, expected YYYY-MM-DD',
    })
    .optional()
    .default(dayjs().format(DEFAULT_DATE_FORMAT)),
  role: z
    .enum(['ADMIN', 'ADMIN_VIEWER', 'BALLBOY', 'COACH', 'CASHIER'] as const)
    .default('ADMIN'),
  coachType: z.enum(['PADEL', 'PADEL_TENNIS', 'TENNIS'] as const).optional(),
  coachProfile: z.string().trim().max(2000).optional(),
  isActive: z.coerce.boolean().optional(),
  image: z.file().optional(),
})

export const createStaffSchema = staffBaseSchema.refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  },
)

export type CreateStaffSchema = z.infer<typeof createStaffSchema>

export const updateStaffSchema = staffBaseSchema
  .partial()
  .omit({ password: true, confirmPassword: true, isActive: true })
  .extend({
    isActive: z.coerce
      .number()
      .optional()
      .refine((val) => val === 0 || val === 1, {
        message: 'isActive must be 0 or 1',
      }),
  })

export type UpdateStaffSchema = z.infer<typeof updateStaffSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6).max(100),
    newPassword: z.string().min(6).max(100),
    confirmNewPassword: z.string().min(6).max(100),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "New passwords don't match",
    path: ['confirmNewPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  })

export type ChangePasswordSchema = z.infer<typeof changePasswordSchema>

export const createCourtCostSchema = z.object({
  courtId: z.string(),
  fromDate: z
    .string()
    .refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
      message: 'Invalid date format, expected YYYY-MM-DD',
    }),
  toDate: z.string().refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
    message: 'Invalid date format, expected YYYY-MM-DD',
  }),
  days: z.array(z.number().min(0).max(7)),
  happyHourPrice: z.number().min(0),
  happyHourDiscountPrice: z.number().min(0).optional(),
  peakHourPrice: z.number().min(0),
  peakHourDiscountPrice: z.number().min(0).optional(),
  closedHours: z.array(z.number()).optional(),
})

export type CreateCourtCostSchema = z.infer<typeof createCourtCostSchema>

export const updateCourtCostSchema = createCourtCostSchema
  .omit({ courtId: true, fromDate: true, toDate: true, days: true })
  .extend({
    date: z.string().refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
      message: 'Invalid date format, expected YYYY-MM-DD',
    }),
  })

export type UpdateCourtCostSchema = z.infer<typeof updateCourtCostSchema>

export const overrideSingleCourtCostSchema = z.object({
  date: z.string().refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
    message: 'Invalid date format, expected YYYY-MM-DD',
  }),
  hour: z.number().min(0),
  courtId: z.string(),
  price: z.number().min(0),
  discountPrice: z.number().min(0).optional(),
})

export type OverrideSingleCourtCostSchema = z.infer<
  typeof overrideSingleCourtCostSchema
>

export const updateSlotPricingSchema = z.object({
  price: z.number().min(0),
  discountPrice: z.number().min(0).optional(),
})

export type UpdateSlotPricingSchema = z.infer<typeof updateSlotPricingSchema>

export const createCourtSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  image: z.file().optional(),
  sport: z.enum(['PADEL', 'TENNIS'] as const).default('PADEL'),
  isActive: z.coerce.boolean().optional(),
})

export type CreateCourtSchema = z.infer<typeof createCourtSchema>

export const updateCourtSchema = createCourtSchema
  .partial()
  .omit({
    isActive: true,
  })
  .extend({
    isActive: z.coerce
      .number()
      .optional()
      .refine((val) => val === 0 || val === 1, {
        message: 'isActive must be 0 or 1',
      }),
  })

export type UpdateCourtSchema = z.infer<typeof updateCourtSchema>

export const createBallboyCostSchema = createCourtCostSchema
  .omit({ courtId: true })
  .extend({
    staffId: z.string(),
  })

export type CreateBallboyCostSchema = z.infer<typeof createBallboyCostSchema>

export const updateBallboyCostSchema = updateCourtCostSchema

export type UpdateBallboyCostSchema = z.infer<typeof updateBallboyCostSchema>

export const overrideSingleBallboyCostSchema = overrideSingleCourtCostSchema
  .omit({ courtId: true })
  .extend({
    staffId: z.string(),
  })

export type OverrideSingleBallboyCostSchema = z.infer<
  typeof overrideSingleBallboyCostSchema
>

export const createCoachCostSchema = createCourtCostSchema
  .omit({ courtId: true })
  .extend({
    staffId: z.string(),
  })

export type CreateCoachCostSchema = z.infer<typeof createCoachCostSchema>

export const updateCoachCostSchema = updateCourtCostSchema

export type UpdateCoachCostSchema = z.infer<typeof updateCoachCostSchema>

export const overrideSingleCoachCostSchema = overrideSingleCourtCostSchema
  .omit({ courtId: true })
  .extend({
    staffId: z.string(),
  })

export type OverrideSingleCoachCostSchema = z.infer<
  typeof overrideSingleCoachCostSchema
>

export const createStaffCostSchema = createCourtCostSchema
  .omit({ courtId: true })
  .extend({
    staffId: z.string(),
  })

export type CreateStaffCostSchema = z.infer<typeof createStaffCostSchema>

export const updateStaffCostSchema = updateCourtCostSchema

export type UpdateStaffCostSchema = z.infer<typeof updateStaffCostSchema>

export const overrideSingleStaffCostSchema = overrideSingleCourtCostSchema
  .omit({ courtId: true })
  .extend({
    staffId: z.string(),
  })

export type OverrideSingleStaffCostSchema = z.infer<
  typeof overrideSingleStaffCostSchema
>

// Banner Schemas
export const createBannerSchema = z.object({
  image: z.file(),
  link: z.string().url().optional(),
  isActive: z.coerce.boolean().optional(),
  startAt: z
    .string()
    .refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
      message: 'Invalid date format, expected YYYY-MM-DD',
    })
    .optional(),
  endAt: z
    .string()
    .refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
      message: 'Invalid date format, expected YYYY-MM-DD',
    })
    .optional(),
  sequence: z.coerce.number().min(0).optional(),
})

export type CreateBannerSchema = z.infer<typeof createBannerSchema>

export const updateBannerSchema = createBannerSchema.partial()

export type UpdateBannerSchema = z.infer<typeof updateBannerSchema>

// Partnership Schemas
export const createPartnershipSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  logo: z.file().optional(),
  isActive: z.coerce.boolean().optional(),
})

export type CreatePartnershipSchema = z.infer<typeof createPartnershipSchema>

export const updatePartnershipSchema = createPartnershipSchema
  .partial()
  .omit({
    isActive: true,
  })
  .extend({
    isActive: z.coerce
      .number()
      .optional()
      .refine((val) => val === 0 || val === 1, {
        message: 'isActive must be 0 or 1',
      }),
  })

export type UpdatePartnershipSchema = z.infer<typeof updatePartnershipSchema>

// Class schema
export const createClassSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(3).max(500).optional(),
  content: z.string().min(3).max(2000).optional(),
  organizerName: z.string().min(3).max(100).optional(),
  speakerName: z.string().min(3).max(100).optional(),
  image: z.file().optional(),
  startDate: z
    .string()
    .refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
      message: 'Invalid date format, expected YYYY-MM-DD',
    }),
  endDate: z
    .string()
    .refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
      message: 'Invalid date format, expected YYYY-MM-DD',
    }),
  startTime: z.string(),
  endTime: z.string(),
  price: z.number().min(0),
  sessions: z.number().min(1),
  capacity: z.number().min(1),
  remaining: z.number().min(0),
  maxBookingPax: z.number().min(1),
  gender: z.enum(Gender).optional(),
  ageMin: z.number().min(0),
  isActive: z.coerce.boolean().optional().default(true),
})

export type CreateClassSchema = z.infer<typeof createClassSchema>

export const updateClassSchema = createClassSchema.partial()

export type UpdateClassSchema = z.infer<typeof updateClassSchema>

// Club schema
export const createClubSchema = z.object({
  name: z.string().min(3).max(100),
  logo: z.file().optional(),
  description: z.string().min(3).optional(),
  rules: z.string().min(3).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  // For admin flows: explicitly choose a leader
  // For user flows: this will typically be omitted and set from the authenticated user
  leaderId: z.string().optional(),
  // Allow toggling active state (mainly for admin)
  isActive: z.coerce.boolean().optional(),
})

export type CreateClubSchema = z.infer<typeof createClubSchema>

export const updateClubSchema = createClubSchema.partial()

export type UpdateClubSchema = z.infer<typeof updateClubSchema>

// Tournament schema
export const createTournamentSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  rules: z.string().optional(),
  rulesHtml: z.string().optional(),
  image: z.file().optional(),
  startDate: z
    .string()
    .refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
      message: 'Invalid date format, expected YYYY-MM-DD',
    }),
  endDate: z
    .string()
    .refine((val) => dayjs(val, 'YYYY-MM-DD', true).isValid(), {
      message: 'Invalid date format, expected YYYY-MM-DD',
    }),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, {
    message: 'Invalid time format, expected HH:mm',
  }),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, {
    message: 'Invalid time format, expected HH:mm',
  }),
  maxTeams: z.coerce.number().min(2),
  teamSize: z.coerce.number().min(1),
  entryFee: z.coerce.number().min(0),
  location: z.string().min(3).max(200),
  isActive: z.coerce.boolean(),
})

export type CreateTournamentSchema = z.infer<typeof createTournamentSchema>

export const updateTournamentSchema = createTournamentSchema.partial()

export type UpdateTournamentSchema = z.infer<typeof updateTournamentSchema>

// Membership schema
export const createMembershipSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  content: z.string().optional(),
  contentHtml: z.string().optional(),
  sport: z.nativeEnum(CourtSport).optional().default(CourtSport.PADEL),
  type: z
    .nativeEnum(MembershipType)
    .optional()
    .default(MembershipType.ALL_HOUR),
  price: z.number().min(0),
  sessions: z.number().min(1),
  duration: z.number().min(1),
  sequence: z.number().min(0).optional(),
  isActive: z.coerce.boolean().optional(),
  benefits: z.array(z.string().max(200)).optional(),
})

export type CreateMembershipSchema = z.infer<typeof createMembershipSchema>

export const updateMembershipSchema = createMembershipSchema
  .partial()
  .omit({
    isActive: true,
  })
  .extend({
    isActive: z.coerce
      .number()
      .optional()
      .refine((val) => val === 0 || val === 1, {
        message: 'isActive must be 0 or 1',
      }),
  })

export type UpdateMembershipSchema = z.infer<typeof updateMembershipSchema>

// Payment Method schemas
export const createPaymentMethodSchema = z.object({
  name: z.string().min(3).max(100),
  logo: z.file().optional(),
  fees: z.coerce.number().min(0),
  percentage: z.string().refine(
    (val) => {
      const num = parseFloat(val)
      return !isNaN(num) && num >= 0
    },
    { message: 'Percentage must be a non-negative number' },
  ),
  channel: z.string().min(2).max(50).optional(),
  sequence: z.coerce.number().min(0).optional().default(0),
  isActive: z.coerce.boolean().optional().default(true),
})

export type CreatePaymentMethodSchema = z.infer<
  typeof createPaymentMethodSchema
>

export const updatePaymentMethodSchema = createPaymentMethodSchema
  .partial()
  .omit({
    isActive: true,
  })
  .extend({
    isActive: z.coerce
      .number()
      .optional()
      .refine((val) => val === 0 || val === 1, {
        message: 'isActive must be 0 or 1',
      }),
  })

export type UpdatePaymentMethodSchema = z.infer<
  typeof updatePaymentMethodSchema
>

const promoCodeRegex = /^[A-Za-z0-9]+$/

export const createPromoCodeSchema = z
  .object({
    name: z.string().min(3).max(100),
    code: z.string().min(3).max(50).regex(promoCodeRegex, {
      message: 'Promo code must be alphanumeric without spaces',
    }),
    discountAmount: z.coerce.number().int().optional(),
    discountPercent: z.coerce.number().int().max(100).optional(),
    startAt: z.string().refine((val) => dayjs(val).isValid(), {
      message: 'Invalid datetime format for startAt',
    }),
    endAt: z.string().refine((val) => dayjs(val).isValid(), {
      message: 'Invalid datetime format for endAt',
    }),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
    maxUsage: z.coerce.number().int().min(1),
  })
  .refine(
    (data) =>
      (data.discountAmount && !data.discountPercent) ||
      (!data.discountAmount && data.discountPercent),
    {
      message: 'Provide either discountAmount or discountPercent',
      path: ['discountAmount'],
    },
  )
  .refine((data) => !dayjs(data.startAt).isAfter(dayjs(data.endAt)), {
    message: 'startAt must be before or equal to endAt',
    path: ['startAt'],
  })

export type CreatePromoCodeSchema = z.infer<typeof createPromoCodeSchema>

export const updatePromoCodeSchema = z
  .object({
    name: z.string().min(3).max(100).optional(),
    code: z
      .string()
      .min(3)
      .max(50)
      .regex(promoCodeRegex, {
        message: 'Promo code must be alphanumeric without spaces',
      })
      .optional(),
    discountAmount: z.coerce.number().int().min(1).optional(),
    discountPercent: z.coerce.number().int().min(1).max(100).optional(),
    startAt: z
      .string()
      .refine((val) => dayjs(val).isValid(), {
        message: 'Invalid datetime format for startAt',
      })
      .optional(),
    endAt: z
      .string()
      .refine((val) => dayjs(val).isValid(), {
        message: 'Invalid datetime format for endAt',
      })
      .optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    maxUsage: z.coerce.number().int().min(1).optional(),
  })
  .refine((data) => !(data.discountAmount && data.discountPercent), {
    message: 'Provide either discountAmount or discountPercent',
    path: ['discountAmount'],
  })
  .refine(
    (data) => {
      if (data.startAt && data.endAt) {
        return !dayjs(data.startAt).isAfter(dayjs(data.endAt))
      }
      return true
    },
    {
      message: 'startAt must be before or equal to endAt',
      path: ['startAt'],
    },
  )

export type UpdatePromoCodeSchema = z.infer<typeof updatePromoCodeSchema>

const ballboySelectionSchema = z.union([
  z.string(),
  z.object({
    slotId: z.string(),
    courtSlotId: z.string(),
  }),
])

// Checkout schema
export const checkoutSchema = z.object({
  bookingId: z.string().optional(), // Optional: for updating existing DRAFT booking
  paymentMethodId: z.string(),
  useMembership: z.boolean().optional().default(true),
  courtSlots: z.array(z.string()).optional(), // Array of slot IDs for court bookings
  coachSlots: z.array(z.string()).optional(), // Array of slot IDs for coach bookings
  ballboySlots: z.array(ballboySelectionSchema).optional(),
  inventories: z
    .array(
      z.object({
        inventoryId: z.string(),
        quantity: z.number().min(1),
        courtSlotId: z.string().optional(),
      }),
    )
    .optional(),
  promoCode: z
    .string()
    .min(3)
    .max(50)
    .regex(promoCodeRegex, {
      message: 'Promo code must be alphanumeric without spaces',
    })
    .optional(),
})

export type CheckoutSchema = z.infer<typeof checkoutSchema>

// Availability queries
export const availableCoachesQuerySchema = z.object({
  startAt: z.string().refine((val) => dayjs(val).isValid(), {
    message: 'Invalid datetime format for startAt',
  }),
  endAt: z.string().refine((val) => dayjs(val).isValid(), {
    message: 'Invalid datetime format for endAt',
  }),
  courtSport: z.nativeEnum(CourtSport).optional(),
})

export type AvailableCoachesQuerySchema = z.infer<
  typeof availableCoachesQuerySchema
>

export const availableInventoryQuerySchema = z
  .object({
    startAt: z.string().optional(),
    endAt: z.string().optional(),
    courtSport: z.nativeEnum(CourtSport).optional(),
  })
  .refine(
    (vals) =>
      (!vals.startAt && !vals.endAt) ||
      (vals.startAt !== undefined && vals.endAt !== undefined),
    { message: 'Both startAt and endAt must be provided together' },
  )

export type AvailableInventoryQuerySchema = z.infer<
  typeof availableInventoryQuerySchema
>

export const availableCourtSlotsQuerySchema = z
  .object({
    startAt: z
      .string()
      .refine((val) => dayjs(val).isValid(), {
        message: 'Invalid datetime format for startAt',
      })
      .optional(),
    endAt: z
      .string()
      .refine((val) => dayjs(val).isValid(), {
        message: 'Invalid datetime format for endAt',
      })
      .optional(),
    courtId: z.string().optional(),
    courtSport: z.enum(['PADEL', 'TENNIS'] as const).optional(),
  })
  .refine(
    (vals) =>
      (!vals.startAt && !vals.endAt) ||
      (vals.startAt !== undefined && vals.endAt !== undefined),
    { message: 'Both startAt and endAt must be provided together' },
  )

export type AvailableCourtSlotsQuerySchema = z.infer<
  typeof availableCourtSlotsQuerySchema
>

export const updateCourtSlotAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
})

export type UpdateCourtSlotAvailabilitySchema = z.infer<
  typeof updateCourtSlotAvailabilitySchema
>

export const updateUserSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  email: z.string().email().min(5).max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
  image: z.file().optional(),
})

export type UpdateUserSchema = z.infer<typeof updateUserSchema>

// Coach Type schemas
export const createCoachTypeSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  isActive: z.coerce.boolean().optional().default(true),
})

export type CreateCoachTypeSchema = z.infer<typeof createCoachTypeSchema>

export const updateCoachTypeSchema = createCoachTypeSchema
  .partial()
  .omit({
    isActive: true,
  })
  .extend({
    isActive: z.coerce
      .number()
      .optional()
      .refine((val) => val === 0 || val === 1, {
        message: 'isActive must be 0 or 1',
      }),
  })

export type UpdateCoachTypeSchema = z.infer<typeof updateCoachTypeSchema>

// Email change schemas
export const requestEmailChangeSchema = z.object({
  newEmail: z.string().email('Invalid email address'),
})

export type RequestEmailChangeSchema = z.infer<typeof requestEmailChangeSchema>

export const verifyEmailChangeSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  code: z.string().length(6, 'OTP code must be 6 digits'),
})

export type VerifyEmailChangeSchema = z.infer<typeof verifyEmailChangeSchema>

// Verification schemas (unified phone/email verification)
export const sendVerificationOtpSchema = z.object({
  type: z.enum(['phone', 'email']),
  phone: z.string().min(10).max(15).optional(),
  email: z.string().email().optional(),
})

export type SendVerificationOtpSchema = z.infer<
  typeof sendVerificationOtpSchema
>

export const verifyVerificationOtpSchema = z
  .object({
    type: z.enum(['phone', 'email']),
    requestId: z.string().min(1, 'Request ID is required'),
    code: z.string().min(4, 'OTP code is required'),
  })
  .superRefine((data, ctx) => {
    const expectedLength = data.type === 'phone' ? 4 : 6
    if (data.code.length !== expectedLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: `OTP code must be ${expectedLength} digits`,
      })
    }
  })

export type VerifyVerificationOtpSchema = z.infer<
  typeof verifyVerificationOtpSchema
>

// Password verification schema
export const verifyPasswordSchema = z.object({
  password: z.string().min(6).max(100),
})

export type VerifyPasswordSchema = z.infer<typeof verifyPasswordSchema>
// Credit card schemas
// Save card using Cards Session JS token (recommended)
export const saveCreditCardSchema = z.object({
  // Cards Session JS flow (recommended)
  cardToken: z.string().optional(), // payment_method_id from Cards Session JS
  cardBrand: z.string().optional(), // e.g., "VISA", "MASTERCARD"
  last4: z
    .string()
    .regex(/^\d{4}$/, 'Card last4 must be 4 digits')
    .optional(),
  expMonth: z.number().int().min(1).max(12).optional(),
  expYear: z.number().int().min(2024).max(2099).optional(),

  // Legacy tokenization flow (fallback)
  cardNumber: z
    .string()
    .regex(/^\d{13,19}$/, 'Card number must be 13-19 digits')
    .optional(),
  cardholderName: z.string().min(1, 'Cardholder name is required').optional(),
  expiryMonth: z.number().int().min(1).max(12).optional(),
  expiryYear: z.number().int().min(2024).max(2099).optional(),
  cvv: z
    .string()
    .regex(/^\d{3,4}$/, 'CVV must be 3 or 4 digits')
    .optional(),

  isDefault: z.boolean().optional().default(false),
})

export type SaveCreditCardSchema = z.infer<typeof saveCreditCardSchema>

export const updateCreditCardSchema = z.object({
  isDefault: z.boolean(),
})

export type UpdateCreditCardSchema = z.infer<typeof updateCreditCardSchema>

// Credit card payment schemas
// Using Payment Sessions + Cards Session JS (correct flow)
export const creditCardPaymentSchema = z.object({
  // --- Payment Session Flow (correct) ---
  // Backend creates payment session, frontend uses card_session.js to collect card
  // No card data is sent to backend anymore!
  saveCard: z.boolean().optional(), // Whether to save card for future use (PAY_AND_SAVE session type)

  // --- Legacy: Saved card flow (kept for backward compatibility) ---
  // TODO: Will be deprecated once frontend implements new save card flow via webhooks
  savedCardId: z.string().optional(), // Use existing saved card
  cvv: z
    .string()
    .regex(/^\d{3,4}$/, 'CVV is required for saved cards')
    .optional(),
})

export type CreditCardPaymentSchema = z.infer<typeof creditCardPaymentSchema>

// Update checkout schema to support credit card
export const extendedCheckoutSchema = z.object({
  bookingId: z.string().optional(),
  paymentMethodId: z.string(),
  useMembership: z.boolean().optional().default(true),
  courtSlots: z.array(z.string()).optional(),
  coachSlots: z.array(z.string()).optional(),
  ballboySlots: z.array(ballboySelectionSchema).optional(),
  inventories: z
    .array(
      z.object({
        inventoryId: z.string(),
        quantity: z.number().min(1),
      }),
    )
    .optional(),
  promoCode: z
    .string()
    .min(3)
    .max(50)
    .regex(promoCodeRegex, {
      message: 'Promo code must be alphanumeric without spaces',
    })
    .optional(),
  // Credit card specific fields
  cardPayment: creditCardPaymentSchema.optional(),
})

export type ExtendedCheckoutSchema = z.infer<typeof extendedCheckoutSchema>

export const applyPromoCodeSchema = z.object({
  promoCode: z.string().min(3).max(50).regex(promoCodeRegex, {
    message: 'Promo code must be alphanumeric without spaces',
  }),
  courtSlots: z.array(z.string()).optional(),
  coachSlots: z.array(z.string()).optional(),
  ballboySlots: z.array(ballboySelectionSchema).optional(),
  inventories: z
    .array(
      z.object({
        inventoryId: z.string(),
        quantity: z.number().min(1),
      }),
    )
    .optional(),
})

export type ApplyPromoCodeSchema = z.infer<typeof applyPromoCodeSchema>
