import { DEFAULT_OTP_CODE, OTP_LENGTH } from '@/constants'
import { env } from '@/env'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { formatPhone, generateOtp } from '@/lib/utils'
import {
  phoneSchema,
  PhoneSchema,
  verifyOtpSchema,
  VerifyOtpSchema,
} from '@/lib/validation'
import { sendPhoneOtp, verifyPhoneOtp } from '@/services/phone.service'
import { zValidator } from '@hono/zod-validator'
import dayjs from 'dayjs'
import { PhoneVerificationType } from 'generated/prisma'
import status from 'http-status'

export const sendPhoneVerificationOtpHandler = factory.createHandlers(
  zValidator('json', phoneSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as PhoneSchema
      const { phone } = validated

      const formattedPhone = await formatPhone(phone)

      const existingPhone = await db.user.findFirst({
        where: {
          phone: formattedPhone,
        },
      })

      if (!existingPhone) {
        return c.json(
          err('Phone number not registered', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
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
        code = await generateOtp(OTP_LENGTH)
        requestId = await sendPhoneOtp(formattedPhone, code)

        if (!requestId) {
          c.var.logger.error(
            `Failed to find OTP request ID for phone ${formattedPhone}`,
          )
          throw new Error('Failed to send OTP')
        }
      }

      await db.phoneVerification.upsert({
        where: { phone: formattedPhone },
        update: {
          requestId,
          code,
          isUsed: false,
          type: PhoneVerificationType.VERIFY_PHONE,
          expiresAt: dayjs().add(5, 'minute').toDate(),
        },
        create: {
          requestId,
          phone: formattedPhone,
          code,
          isUsed: false,
          type: PhoneVerificationType.VERIFY_PHONE,
          expiresAt: dayjs().add(5, 'minute').toDate(),
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

      const verificationRecord = await db.phoneVerification.findUnique({
        where: {
          requestId,
          phone: phoneNumber,
        },
      })

      if (!verificationRecord) {
        c.var.logger.error(
          `No verification record found for phone ${phoneNumber} with requestId ${requestId}`,
        )
        return c.json(
          err('Invalid requestId or phone number', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      if (verificationRecord.isUsed) {
        c.var.logger.error(
          `OTP code already used for phone ${phoneNumber}, requestId: ${requestId}`,
        )

        return c.json(
          err('OTP code has already been used', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      if (verificationRecord.code !== code) {
        c.var.logger.error(
          `Invalid OTP code for phone ${phoneNumber}, requestId: ${requestId}`,
        )

        return c.json(
          err('Invalid OTP code', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      if (verificationRecord.expiresAt < dayjs().toDate()) {
        c.var.logger.error(
          `OTP code expired for phone ${phoneNumber}, requestId: ${requestId}`,
        )

        return c.json(
          err('OTP code has expired', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      if (env.nodeEnv === 'production') {
        const success = await verifyPhoneOtp(requestId, code)

        if (!success) {
          c.var.logger.error(
            `Failed to verify OTP with external service for phone ${phoneNumber}, requestId: ${requestId}`,
          )

          return c.json(
            err('Failed to verify OTP', status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }
      }

      await db.phoneVerification.update({
        where: {
          requestId,
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
