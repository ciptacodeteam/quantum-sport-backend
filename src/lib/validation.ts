import z from 'zod'

export const phoneSchema = z.object({
  phone: z.string().min(10).max(15),
})

export const verifyOtpPayloadSchema = z.object({
  phone: z.string().min(10).max(15),
  code: z.string().length(4),
  requestId: z.string(),
})
