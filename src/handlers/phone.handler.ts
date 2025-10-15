import { DEFAULT_OTP_CODE, OTP_LENGTH } from '@/constants'
import { env } from '@/env'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { formatPhone, generateOtp } from '@/lib/utils'
import {
  SendPhoneVerificationOtpRouteDoc,
  VerifyPhoneOtpRouteDoc,
} from '@/routes/phone.route'
import { sendPhoneOtp, verifyPhoneOtp } from '@/services/phone.service'
import { AppRouteHandler } from '@/types'
import dayjs from 'dayjs'
import { PhoneVerificationType } from 'generated/prisma'
import status from 'http-status'

export const sendPhoneVerificationOtp: AppRouteHandler<
  SendPhoneVerificationOtpRouteDoc
> = async (c) => {
  try {
    const validated = c.req.valid('json')
    const phone = validated.phone

    const formattedPhone = await formatPhone(phone)

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

    c.var.logger.info(`OTP sent to ${formattedPhone}, requestId: ${requestId}`)

    return c.json(
      ok({ phone: formattedPhone, requestId }, 'OTP sent successfully'),
    )
  } catch (err) {
    c.var.logger.fatal(`Error sending phone OTP: ${err}`)
    throw err
  }
}

export const verifyPhoneVerificationOtp: AppRouteHandler<
  VerifyPhoneOtpRouteDoc
> = async (c) => {
  try {
    const validated = c.req.valid('json')
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
}
