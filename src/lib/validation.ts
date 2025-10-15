import z from 'zod'

export const phoneSchema = z.object({
  phone: z.string().min(10).max(15),
})

export const authTokenCookieSchema = z.object({
  token: z.string().min(10).describe('Access token'),
  refreshToken: z.string().min(10).describe('Refresh token'),
})

export const verifyOtpPayloadSchema = z.object({
  phone: z.string().min(10).max(15),
  code: z.string().length(4),
  requestId: z.string(),
})

export const loginSchema = phoneSchema.extend({
  code: z.string().length(4),
  requestId: z.string(),
})

export const registerSchema = phoneSchema.extend({
  name: z.string().min(3).max(100),
  code: z.string().length(4),
  requestId: z.string(),
})

export const tokenSchema = z.object({
  token: z.string().min(10),
})

export const refreshTokenSchema = tokenSchema

export const forgotPasswordSchema = phoneSchema

export const resetPasswordSchema = z.object({
  phone: z.string().min(10).max(15),
  code: z.string().length(4),
  requestId: z.string(),
  newPassword: z.string().min(6).max(100),
})

export const loginWithEmailSchema = z.object({
  email: z.string().email().min(5).max(100),
  password: z.string().min(6).max(100),
})

export const adminRegisterSchema = loginWithEmailSchema.extend({
  name: z.string().min(3).max(100),
})

export const adminProfileSchema = z.object({
  name: z.string().min(3).max(100),
  phone: z.string().min(10).max(15).optional(),
  email: z.string().email().min(5).max(100).optional(),
  image: z.file().optional(),
})
