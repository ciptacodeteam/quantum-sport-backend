import { DEFAULT_OTP_CODE } from '@/constants'
import { env } from '@/env'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { formatPhone, generateOtp } from '@/lib/utils'
import {
  sendVerificationOtpSchema,
  SendVerificationOtpSchema,
  verifyVerificationOtpSchema,
  VerifyVerificationOtpSchema,
} from '@/lib/validation'
import { sendPhoneOtp, verifyPhoneOtp } from '@/services/phone.service'
import { queueSendTemplatedEmail } from '@/services/email.service'
import { requireAuth } from '@/middlewares/auth'
import { zValidator } from '@hono/zod-validator'
import dayjs from 'dayjs'
import { PhoneVerificationType } from '@prisma/client'
import status from 'http-status'
import crypto from 'crypto'

/**
 * Send OTP for phone or email verification
 * POST /verification/send-otp
 */
export const sendVerificationOtpHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', sendVerificationOtpSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user?.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      // Fetch full user data
      const userData = await db.user.findUnique({
        where: { id: user.id },
        select: { id: true, name: true, email: true, phone: true },
      })

      if (!userData) {
        return c.json(err('User not found', status.NOT_FOUND), status.NOT_FOUND)
      }

      const { type, phone, email } = c.req.valid(
        'json',
      ) as SendVerificationOtpSchema

      // Phone verification
      if (type === 'phone') {
        if (!phone) {
          return c.json(
            err(
              'Phone number is required for phone verification',
              status.BAD_REQUEST,
            ),
            status.BAD_REQUEST,
          )
        }

        const formattedPhone = await formatPhone(phone)

        // Check if phone already verified for this user
        const existingUser = await db.user.findFirst({
          where: {
            phone: formattedPhone,
            phoneVerified: true,
            id: { not: user.id },
          },
        })

        if (existingUser) {
          return c.json(
            err(
              'Phone number already verified by another user',
              status.CONFLICT,
            ),
            status.CONFLICT,
          )
        }

        // Check rate limiting
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
          return c.json(
            err(
              'OTP already sent recently. Please wait before requesting a new one.',
              status.TOO_MANY_REQUESTS,
            ),
            status.TOO_MANY_REQUESTS,
          )
        }

        let code = DEFAULT_OTP_CODE
        let requestId = Math.random().toString(36).substring(2, 30)
        const expiresAt = dayjs().add(10, 'minute').toDate()

        if (env.nodeEnv === 'production') {
          const otpResult = await sendPhoneOtp(formattedPhone)
          // Fazpass returns a masked OTP — store placeholder only; verify via Fazpass API
          code = 'MASKED'
          requestId = otpResult.requestId

          if (!requestId) {
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
          `Phone verification OTP sent to ${formattedPhone} for user ${user.id}`,
        )

        return c.json(
          ok(
            {
              phone: formattedPhone,
              requestId,
              expiresAt,
            },
            'OTP sent to phone successfully',
          ),
          status.OK,
        )
      }

      // Email verification
      if (type === 'email') {
        if (!email) {
          return c.json(
            err('Email is required for email verification', status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }

        // Check if email already verified for another user
        const existingUser = await db.user.findFirst({
          where: {
            email: email.toLowerCase(),
            emailVerified: true,
            id: { not: user.id },
          },
        })

        if (existingUser) {
          return c.json(
            err('Email already verified by another user', status.CONFLICT),
            status.CONFLICT,
          )
        }

        // Check rate limiting
        const existingRecord = await db.emailVerification.findFirst({
          where: {
            userId: user.id,
            email: email.toLowerCase(),
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
          return c.json(
            err(
              'OTP already sent recently. Please wait before requesting a new one.',
              status.TOO_MANY_REQUESTS,
            ),
            status.TOO_MANY_REQUESTS,
          )
        }

        const code = await generateOtp(6)
        const requestId = crypto.randomUUID()
        const expiresAt = dayjs().add(10, 'minutes').toDate()

        // Delete old pending verifications
        await db.emailVerification.deleteMany({
          where: {
            userId: user.id,
            email: email.toLowerCase(),
            isUsed: false,
          },
        })

        // Create new verification record
        await db.emailVerification.create({
          data: {
            userId: user.id,
            email: email.toLowerCase(),
            code,
            requestId,
            expiresAt,
          },
        })

        // Send OTP email
        await queueSendTemplatedEmail(email, 'emailVerification', {
          name: userData.name,
          action: userData.email
            ? 'verify your email address'
            : 'verify your email address',
          code,
        })

        c.var.logger.info(
          `Email verification OTP sent to ${email} for user ${user.id}`,
        )

        return c.json(
          ok(
            { email: email.toLowerCase(), requestId, expiresAt },
            'OTP sent to email successfully',
          ),
          status.OK,
        )
      }

      return c.json(
        err('Invalid verification type', status.BAD_REQUEST),
        status.BAD_REQUEST,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in sendVerificationOtpHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Verify OTP for phone or email
 * POST /verification/verify-otp
 */
export const verifyVerificationOtpHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', verifyVerificationOtpSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user?.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      const { type, requestId, code } = c.req.valid(
        'json',
      ) as VerifyVerificationOtpSchema

      // Phone verification
      if (type === 'phone') {
        const normalizedCode = String(code).trim()
        const verification = await db.phoneVerification.findFirst({
          where: { requestId, isUsed: false },
        })

        if (!verification) {
          return c.json(
            err(
              'Permintaan OTP tidak valid. Silakan kirim ulang OTP.',
              status.BAD_REQUEST,
            ),
            status.BAD_REQUEST,
          )
        }

        if (verification.isUsed) {
          return c.json(
            err('Kode OTP sudah digunakan', status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }

        if (dayjs().isAfter(dayjs(verification.expiresAt))) {
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
              `Failed to verify OTP with Fazpass for requestId ${requestId}, message: ${result.message}`,
            )
            return c.json(
              err(result.message, status.BAD_REQUEST),
              status.BAD_REQUEST,
            )
          }
        } else if (verification.code !== normalizedCode) {
          c.var.logger.error(
            `Invalid OTP code for requestId ${requestId}. expectedLength=${verification.code.length}, receivedLength=${normalizedCode.length}`,
          )
          return c.json(
            err('Kode OTP salah', status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }

        // Update user phone verification status
        await db.user.update({
          where: { id: user.id },
          data: {
            phone: verification.phone,
            phoneVerified: true,
          },
        })

        // Mark verification as used
        await db.phoneVerification.updateMany({
          where: { requestId, phone: verification.phone },
          data: { isUsed: true },
        })

        c.var.logger.info(
          `Phone verified successfully for user ${user.id}: ${verification.phone}`,
        )

        return c.json(
          ok(
            {
              phone: verification.phone,
              phoneVerified: true,
            },
            'Phone verified successfully',
          ),
          status.OK,
        )
      }

      // Email verification
      if (type === 'email') {
        const verification = await db.emailVerification.findUnique({
          where: { requestId },
        })

        if (!verification) {
          return c.json(
            err('Invalid verification request', status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }

        if (verification.userId !== user.id) {
          return c.json(
            err('Unauthorized verification request', status.FORBIDDEN),
            status.FORBIDDEN,
          )
        }

        if (verification.isUsed) {
          return c.json(
            err('OTP code has already been used', status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }

        if (dayjs().isAfter(dayjs(verification.expiresAt))) {
          return c.json(
            err('OTP code has expired', status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }

        if (verification.code !== code) {
          return c.json(
            err('Invalid OTP code', status.BAD_REQUEST),
            status.BAD_REQUEST,
          )
        }

        // Update user email verification status
        await db.user.update({
          where: { id: user.id },
          data: {
            email: verification.email,
            emailVerified: true,
          },
        })

        // Mark verification as used
        await db.emailVerification.update({
          where: { requestId },
          data: { isUsed: true },
        })

        c.var.logger.info(
          `Email verified successfully for user ${user.id}: ${verification.email}`,
        )

        return c.json(
          ok(
            {
              email: verification.email,
              emailVerified: true,
            },
            'Email verified successfully',
          ),
          status.OK,
        )
      }

      return c.json(
        err('Invalid verification type', status.BAD_REQUEST),
        status.BAD_REQUEST,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in verifyVerificationOtpHandler: ${error}`)
      throw error
    }
  },
)
