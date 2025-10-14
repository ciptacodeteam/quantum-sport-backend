import { auth } from '@/lib/auth'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { formatPhone } from '@/lib/utils'
import dayjs from 'dayjs'
import status from 'http-status'

export async function sendPhoneVerificationOtp(c): Promise<Response> {
  try {
    const validated = c.req.valid('form')
    const phone = validated.body.phone

    const phoneNumber = await formatPhone(phone)

    c.var.logger.info(`Sending phone OTP to ${phoneNumber}`)

    await auth.api.sendPhoneNumberOTP({
      headers: c.req.raw.headers,
      body: {
        phoneNumber,
      },
    })

    const requestId = await db.phoneVerification.findFirst({
      where: {
        phone: phoneNumber,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        requestId: true,
      },
    })

    if (!requestId) {
      c.var.logger.error(
        `Failed to find OTP request ID for phone ${phoneNumber}`,
      )
      throw new Error('Failed to send OTP')
    }

    c.var.logger.info(
      `OTP sent to ${phoneNumber}, requestId: ${requestId.requestId}`,
    )

    return c.json(
      ok(
        { phone: phoneNumber, requestId: requestId.requestId },
        'OTP sent successfully',
      ),
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

    const phoneNumber = await formatPhone(phone)

    c.var.logger.info(
      `Verifying phone OTP for ${phoneNumber}, requestId: ${requestId}`,
    )

    const verificationRecord = await db.phoneVerification.findUnique({
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
        err('Invalid requestId or phone number', status.BAD_REQUEST),
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

    await auth.api.verifyPhoneNumber({
      headers: c.req.raw.headers,
      body: {
        phoneNumber: phoneNumber,
        code,
      },
    })

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
