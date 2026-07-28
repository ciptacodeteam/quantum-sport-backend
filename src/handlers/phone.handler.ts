import { DEFAULT_OTP_CODE } from '@/constants'
import { env } from '@/env'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { hashPassword } from '@/lib/password'
import { formatPhone } from '@/lib/utils'
import {
  phoneSchema,
  PhoneSchema,
  verifyOtpSchema,
  VerifyOtpSchema,
} from '@/lib/validation'
import { sendPhoneOtp, verifyPhoneOtp } from '@/services/phone.service'
import { zValidator } from '@hono/zod-validator'
import dayjs from 'dayjs'
import { PhoneVerificationType, UserSource } from '@prisma/client'
import status from 'http-status'
import z from 'zod'

const sendPhoneOtpSchema = phoneSchema.extend({
  name: z.string().min(3).max(100).optional(),
  password: z.string().min(6).max(100).optional(),
})

export const sendPhoneVerificationOtpHandler = factory.createHandlers(
  zValidator('json', sendPhoneOtpSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as PhoneSchema & {
        name?: string
        password?: string
      }
      const { phone, name, password } = validated

      const formattedPhone = await formatPhone(phone)
      const isRegisterRequest = !!name && !!password

      if (isRegisterRequest) {
        const existingUser = await db.user.findUnique({
          where: { phone: formattedPhone },
          select: { id: true, phoneVerified: true },
        })

        if (existingUser?.phoneVerified) {
          return c.json(
            err('User already exists', status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }

        const hashedPassword = await hashPassword(password)

        if (existingUser) {
          await db.user.update({
            where: { id: existingUser.id },
            data: {
              name,
              password: hashedPassword,
            },
          })
        } else {
          await db.user.create({
            data: {
              name,
              phone: formattedPhone,
              password: hashedPassword,
              phoneVerified: false,
              source: UserSource.ONLINE,
            },
          })
        }
      }

      const existingRecord = await db.phoneVerification.findFirst({
        where: {
          phone: formattedPhone,
          isUsed: false,
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      if (
        existingRecord &&
        dayjs(existingRecord.createdAt).add(1, 'minute') > dayjs()
      ) {
        c.var.logger.warn(
          `OTP already sent recently to ${formattedPhone}, requestId: ${existingRecord.requestId}`,
        )
        return c.json(
          err(
            'OTP already sent recently. Please wait before requesting a new one.',
            status.TOO_MANY_REQUESTS,
          ),
          status.TOO_MANY_REQUESTS,
        )
      }

      c.var.logger.info(`Sending phone OTP to ${formattedPhone}`)

      let code = DEFAULT_OTP_CODE
      let requestId = Math.random().toString(36).substring(2, 30)

      if (env.nodeEnv === 'production') {
        const otpResult = await sendPhoneOtp(formattedPhone)
        // Fazpass returns a masked OTP — store placeholder only; verify via Fazpass API
        code = 'MASKED'
        requestId = otpResult.requestId

        if (!requestId) {
          c.var.logger.error(
            `Failed to find OTP request ID for phone ${formattedPhone}`,
          )
          throw new Error('Failed to send OTP')
        }
      }

      const expiresAt = dayjs().add(10, 'minute').toDate()

      await db.phoneVerification.upsert({
        where: { phone: formattedPhone },
        update: {
          requestId,
          code,
          isUsed: false,
          type: PhoneVerificationType.VERIFY_PHONE,
          expiresAt,
          createdAt: new Date(),
        },
        create: {
          requestId,
          phone: formattedPhone,
          code,
          isUsed: false,
          type: PhoneVerificationType.VERIFY_PHONE,
          expiresAt,
        },
      })

      c.var.logger.info(
        `OTP sent to ${formattedPhone}, requestId: ${requestId}`,
      )

      return c.json(
        ok({ phone: formattedPhone, requestId }, 'OTP sent successfully'),
      )
    } catch (err) {
      c.var.logger.fatal(`Error sending phone OTP: ${err}`)
      throw err
    }
  },
)

export const verifyPhoneVerificationOtpHandler = factory.createHandlers(
  zValidator('json', verifyOtpSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as VerifyOtpSchema
      const { phone, code, requestId } = validated

      const phoneNumber = await formatPhone(phone)

      c.var.logger.info(
        `Verifying phone OTP for ${phoneNumber}, requestId: ${requestId}`,
      )

      const verificationRecord = await db.phoneVerification.findFirst({
        where: {
          requestId,
          phone: phoneNumber,
          isUsed: false,
        },
      })

      if (!verificationRecord) {
        c.var.logger.error(
          `No verification record found for phone ${phoneNumber} with requestId ${requestId}`,
        )
        return c.json(
          err(
            'Permintaan OTP tidak valid. Silakan kirim ulang OTP.',
            status.BAD_REQUEST,
          ),
          status.BAD_REQUEST,
        )
      }

      const normalizedCode = String(code).trim()

      if (verificationRecord.isUsed) {
        c.var.logger.error(
          `OTP code already used for phone ${phoneNumber}, requestId: ${requestId}`,
        )

        return c.json(
          err('Kode OTP sudah digunakan', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      if (verificationRecord.expiresAt < dayjs().toDate()) {
        c.var.logger.error(
          `OTP code expired for phone ${phoneNumber}, requestId: ${requestId}`,
        )

        return c.json(
          err('Kode OTP sudah kadaluarsa. Silakan kirim ulang.', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      if (env.nodeEnv === 'production') {
        // Fazpass request API masks the OTP; verify with provider, not local DB code
        const result = await verifyPhoneOtp(requestId, normalizedCode)

        if (!result.success) {
          c.var.logger.error(
            `Failed to verify OTP with Fazpass for phone ${phoneNumber}, requestId: ${requestId}, message: ${result.message}`,
          )

          return c.json(
            err(result.message, status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }
      } else if (verificationRecord.code !== normalizedCode) {
        c.var.logger.error(
          `Invalid OTP code for phone ${phoneNumber}, requestId: ${requestId}`,
        )

        return c.json(
          err('Kode OTP salah', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      await db.phoneVerification.update({
        where: {
          phone: phoneNumber,
        },
        data: {
          isUsed: true,
        },
      })

      c.var.logger.info(
        `Phone OTP verified for ${phoneNumber}, requestId: ${requestId}`,
      )

      return c.json(ok(null, 'Phone number verified successfully'))
    } catch (err) {
      c.var.logger.fatal(`Error verifying phone OTP: ${err}`)
      throw err
    }
  },
)
