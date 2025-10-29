import { DEFAULT_DATE_FORMAT } from '@/config'
import dayjs from 'dayjs'
import { Role } from '@prisma/client'
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

export const createInventorySchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  quantity: z.number().min(0),
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

export const createStaffSchema = z
  .object({
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
    role: z.enum(Role).default(Role.ADMIN),
    isActive: z.coerce.boolean().optional(),
    image: z.file().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

export type CreateStaffSchema = z.infer<typeof createStaffSchema>

export const updateStaffSchema = createStaffSchema
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
  peakHourPrice: z.number().min(0),
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
})

export type OverrideSingleCourtCostSchema = z.infer<
  typeof overrideSingleCourtCostSchema
>

export const createCourtSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(3).max(500).optional(),
  image: z.file().optional(),
  isActive: z.coerce.boolean().optional(),
})

export type CreateCourtSchema = z.infer<typeof createCourtSchema>

export const updateCourtSchema = createCourtSchema.partial()

export type UpdateCourtSchema = z.infer<typeof updateCourtSchema>

export const createBallboyCostSchema = createCourtCostSchema
  .omit({ courtId: true })
  .extend({
    ballboyId: z.string(),
  })

export type CreateBallboyCostSchema = z.infer<typeof createBallboyCostSchema>

export const updateBallboyCostSchema = updateCourtCostSchema

export type UpdateBallboyCostSchema = z.infer<typeof updateBallboyCostSchema>

export const overrideSingleBallboyCostSchema = overrideSingleCourtCostSchema
  .omit({ courtId: true })
  .extend({
    ballboyId: z.string(),
  })

export type OverrideSingleBallboyCostSchema = z.infer<
  typeof overrideSingleBallboyCostSchema
>

export const createCoachCostSchema = createCourtCostSchema
  .omit({ courtId: true })
  .extend({
    coachId: z.string(),
  })

export type CreateCoachCostSchema = z.infer<typeof createCoachCostSchema>

export const updateCoachCostSchema = updateCourtCostSchema

export type UpdateCoachCostSchema = z.infer<typeof updateCoachCostSchema>

export const overrideSingleCoachCostSchema = overrideSingleCourtCostSchema
  .omit({ courtId: true })
  .extend({
    coachId: z.string(),
  })

export type OverrideSingleCoachCostSchema = z.infer<
  typeof overrideSingleCoachCostSchema
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
  startTime: z.string().refine((val) => dayjs(val, 'HH:mm', true).isValid(), {
    message: 'Invalid time format, expected HH:mm',
  }),
  endTime: z.string().refine((val) => dayjs(val, 'HH:mm', true).isValid(), {
    message: 'Invalid time format, expected HH:mm',
  }),
  price: z.number().min(0),
  sessions: z.number().min(1),
  capacity: z.number().min(1),
  remaining: z.number().min(0),
  maxBookingPax: z.number().min(1),
  gender: z.enum(['ALL', 'MALE', 'FEMALE']),
  ageMin: z.number().min(0),
  isActive: z.coerce.boolean(),
})

export type CreateClassSchema = z.infer<typeof createClassSchema>

export const updateClassSchema = createClassSchema.partial()

export type UpdateClassSchema = z.infer<typeof updateClassSchema>

// Club schema
export const createClubSchema = z.object({
  name: z.string().min(3).max(100),
  logo: z.file().optional(),
  description: z.string().min(3).max(500).optional(),
  rules: z.string().min(3).max(2000).optional(),
  leaderId: z.string(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  isActive: z.coerce.boolean().optional(),
})

export type CreateClubSchema = z.infer<typeof createClubSchema>

export const updateClubSchema = createClubSchema.partial()

export type UpdateClubSchema = z.infer<typeof updateClubSchema>

// Membership schema
export const createMembershipSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(3).max(500).optional(),
  content: z.string().min(3).max(2000).optional(),
  price: z.number().min(0),
  sessions: z.number().min(1),
  duration: z.number().min(1),
  sequence: z.number().min(0).optional(),
  isActive: z.coerce.boolean().optional(),
})

export type CreateMembershipSchema = z.infer<typeof createMembershipSchema>

export const updateMembershipSchema = createMembershipSchema.partial()

export type UpdateMembershipSchema = z.infer<typeof updateMembershipSchema>

// Payment Method schemas
export const createPaymentMethodSchema = z.object({
  name: z.string().min(3).max(100),
  logo: z.file().optional(),
  fees: z.coerce.number().min(0),
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

// Checkout schema
export const checkoutSchema = z.object({
  bookingId: z.string().optional(), // Optional: for updating existing DRAFT booking
  paymentMethodId: z.string(),
  courtSlots: z.array(z.string()).optional(), // Array of slot IDs for court bookings
  coachSlots: z.array(z.string()).optional(), // Array of slot IDs for coach bookings
  ballboySlots: z.array(z.string()).optional(), // Array of slot IDs for ballboy bookings
  inventories: z
    .array(
      z.object({
        inventoryId: z.string(),
        quantity: z.number().min(1),
      }),
    )
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
})

export type AvailableCoachesQuerySchema = z.infer<
  typeof availableCoachesQuerySchema
>

export const availableInventoryQuerySchema = z
  .object({
    startAt: z.string().optional(),
    endAt: z.string().optional(),
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
