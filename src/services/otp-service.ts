import { BadRequestException } from '@/exceptions'
import { log } from '@/lib/logger'
import { db } from '@/lib/prisma'
import dayjs from 'dayjs'

export async function validateOtp(
  phone: string,
  requestId: string,
  code: string,
) {
  const verificationRecord = await db.phoneVerification.findUnique({
    where: {
      requestId,
      phone,
    },
  })

  if (!verificationRecord) {
    log.error(
      `No verification record found for phone ${phone} with requestId ${requestId}`,
    )
    throw new BadRequestException('Invalid OTP request')
  }

  if (verificationRecord.isUsed) {
    log.error(
      `OTP code already used for phone ${phone}, requestId: ${requestId}`,
    )

    throw new BadRequestException('OTP code has already been used')
  }

  if (verificationRecord.code !== code) {
    log.error(`Invalid OTP code for phone ${phone}, requestId: ${requestId}`)
    throw new BadRequestException('Invalid OTP code')
  }

  if (verificationRecord.expiresAt < dayjs().toDate()) {
    log.error(`Expired OTP code for phone ${phone}, requestId: ${requestId}`)
    throw new BadRequestException('OTP code has expired')
  }

  return verificationRecord
}
