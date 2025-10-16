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
  code: z.string().length(4),
  requestId: z.string(),
})

export type LoginSchema = z.infer<typeof loginSchema>

export const registerSchema = phoneSchema.extend({
  name: z.string().min(3).max(100),
  code: z.string().length(4),
  requestId: z.string(),
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
  code: z.string().length(4),
  requestId: z.string(),
  newPassword: z.string().min(6).max(100),
})

export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>

export const loginWithEmailSchema = z.object({
  email: z.email().min(5).max(100),
  password: z.string().min(6).max(100),
})

export type LoginWithEmailSchema = z.infer<typeof loginWithEmailSchema>

export const registerAdminSchema = loginWithEmailSchema.extend({
  name: z.string().min(3).max(100),
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
  description: z.string().min(3).max(500).optional(),
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
