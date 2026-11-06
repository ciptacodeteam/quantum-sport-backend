import { customerAccountAction } from '@/lib/customer-account-state'
import { DEFAULT_OTP_CODE } from '@/constants'
import { isDeployedEnv } from '@/env'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { formatPhone } from '@/lib/utils'
import {
  phoneSchema,
  PhoneSchema,
  verifyOtpSchema,
  VerifyOtpSchema,
} from '@/lib/validation'
import { sendPhoneOtp } from '@/services/phone.service'
import { validateOtp } from '@/services/otp.service'
import { BadRequestException } from '@/exceptions'
import { zValidator } from '@hono/zod-validator'
import dayjs from 'dayjs'
import { PhoneVerificationType } from '@prisma/client'
import status from 'http-status'
import z from 'zod'

const sendPhoneOtpSchema = phoneSchema.extend({
  purpose: z.enum(['REGISTER', 'VERIFY_PHONE']).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  password: z.string().min(6).max(100).optional(),
})

export const sendPhoneVerificationOtpHandler = factory.createHandlers(
  zValidator('json', sendPhoneOtpSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as PhoneSchema & {
        name?: string
        password?: string
        purpose?: 'REGISTER' | 'VERIFY_PHONE'
      }
      const { phone, name, password } = validated

      const formattedPhone = await formatPhone(phone)
      const isRegisterRequest =
        validated.purpose === 'REGISTER' || (!!name && !!password)
      const otpType = isRegisterRequest
        ? PhoneVerificationType.REGISTER
        : PhoneVerificationType.VERIFY_PHONE

      if (isRegisterRequest) {
        const existingUser = await db.user.findUnique({
          where: { phone: formattedPhone },
          select: {
            id: true,
            phoneVerified: true,
            source: true,
            password: true,
            googleId: true,
          },
        })

        if (customerAccountAction(existingUser) === 'LOGIN') {
          return c.json(
            err(
              'Nomor WhatsApp sudah terdaftar. Silakan login atau gunakan lupa password.',
              status.BAD_REQUEST,
              { nextAction: 'LOGIN', phone: formattedPhone },
            ),
            status.BAD_REQUEST,
          )
        }

        // Sending an OTP must never create or mutate customer credentials.
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

      if (isDeployedEnv()) {
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
          attempts: 0,
          type: otpType,
          expiresAt,
          createdAt: new Date(),
        },
        create: {
          requestId,
          phone: formattedPhone,
          code,
          isUsed: false,
          attempts: 0,
          type: otpType,
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

      const record = await validateOtp(
        phoneNumber,
        requestId,
        code,
        PhoneVerificationType.VERIFY_PHONE,
      )
      const consumed = await db.phoneVerification.updateMany({
        where: {
          id: record.id,
          phone: phoneNumber,
          requestId,
          type: PhoneVerificationType.VERIFY_PHONE,
          code: record.code,
          isUsed: false,
          expiresAt: { gt: new Date() },
        },
        data: { isUsed: true },
      })
      if (consumed.count !== 1)
        throw new BadRequestException(
          'OTP sudah digunakan atau tidak berlaku. Silakan kirim ulang OTP.',
        )

      return c.json(ok(null, 'Phone number verified successfully'))
    } catch (err) {
      c.var.logger.fatal(`Error verifying phone OTP: ${err}`)
      throw err
    }
  },
)
