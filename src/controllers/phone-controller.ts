import { auth } from '@/lib/auth'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import dayjs from 'dayjs'
import status from 'http-status'

export async function sendPhoneVerificationOtp(c): Promise<Response> {
  try {
    const validated = c.req.valid('form')
    const phone = validated.body.phone

    c.var.logger.info(`Sending phone OTP to ${phone}`)

    await auth.api.sendPhoneNumberOTP({
      headers: c.req.raw.headers,
      body: {
        phoneNumber: phone,
      },
    })

    const requestId = await db.phoneVerification.findFirst({
      where: {
        phone,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        requestId: true,
      },
    })

    if (!requestId) {
      c.var.logger.error(`Failed to find OTP request ID for phone ${phone}`)
      throw new Error('Failed to send OTP')
    }

    c.var.logger.info(`OTP sent to ${phone}, requestId: ${requestId.requestId}`)

    return c.json(
      ok({ phone, requestId: requestId.requestId }, 'OTP sent successfully'),
    )
  } catch (err) {
    c.var.logger.fatal(`Error sending phone OTP: ${err}`)
    throw err
  }
}

export async function verifyPhoneVerificationOtp(c) {
  try {
    const validated = c.req.valid('form')
    const { phone, code, requestId } = validated.body

    c.var.logger.info(
      `Verifying phone OTP for ${phone}, requestId: ${requestId}`,
    )

    const verificationRecord = await db.phoneVerification.findUnique({
      where: {
        requestId,
        phone,
        isUsed: false,
      },
    })

    if (!verificationRecord) {
      c.var.logger.error(
        `No verification record found for phone ${phone} with requestId ${requestId}`,
      )
      return c.json(
        err('Invalid requestId or phone number', status.BAD_REQUEST),
        status.BAD_REQUEST,
      )
    }

    if (verificationRecord.code !== code) {
      c.var.logger.error(
        `Invalid OTP code for phone ${phone}, requestId: ${requestId}`,
      )

      return c.json(
        err('Invalid OTP code', status.BAD_REQUEST),
        status.BAD_REQUEST,
      )
    }

    if (verificationRecord.expiresAt < dayjs().toDate()) {
      c.var.logger.error(
        `OTP code expired for phone ${phone}, requestId: ${requestId}`,
      )

      return c.json(
        err('OTP code has expired', status.BAD_REQUEST),
        status.BAD_REQUEST,
      )
    }

    await auth.api.verifyPhoneNumber({
      headers: c.req.raw.headers,
      body: {
        phoneNumber: phone,
        code,
      },
    })

    await db.phoneVerification.update({
      where: {
        requestId,
        phone,
      },
      data: {
        isUsed: true,
      },
    })

    c.var.logger.info(
      `Phone OTP verified for ${phone}, requestId: ${requestId}`,
    )

    return c.json(ok(null, 'Phone number verified successfully'))
  } catch (err) {
    c.var.logger.fatal(`Error verifying phone OTP: ${err}`)
    throw err
  }
}
