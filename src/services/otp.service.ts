import { DEFAULT_OTP_CODE } from '@/constants'
import { env } from '@/env'
import { BadRequestException } from '@/exceptions'
import { log } from '@/lib/logger'
import { db } from '@/lib/prisma'
import { verifyPhoneOtp } from '@/services/phone.service'
import dayjs from 'dayjs'

export async function validateOtp(
  phone: string,
  requestId: string,
  code: string,
) {
  const verificationRecord = await db.phoneVerification.findFirst({
    where: {
      requestId,
      phone,
      isUsed: false,
    },
  })

  if (!verificationRecord) {
    log.error(
      `No verification record found for phone ${phone} with requestId ${requestId}`,
    )
    throw new BadRequestException(
      'Permintaan OTP tidak valid. Silakan kirim ulang OTP.',
    )
  }

  const normalizedCode = String(code).trim()

  if (verificationRecord.isUsed) {
    log.error(
      `OTP code already used for phone ${phone}, requestId: ${requestId}`,
    )

    throw new BadRequestException('Kode OTP sudah digunakan')
  }

  if (verificationRecord.expiresAt < dayjs().toDate()) {
    log.error(`Expired OTP code for phone ${phone}, requestId: ${requestId}`)
    throw new BadRequestException(
      'Kode OTP sudah kadaluarsa. Silakan kirim ulang.',
    )
  }

  // Fazpass /otp/request returns a MASKED otp — never compare it locally in production.
  // Always verify with Fazpass using the code the user received.
  if (env.nodeEnv === 'production') {
    const result = await verifyPhoneOtp(requestId, normalizedCode)
    if (!result.success) {
      throw new BadRequestException(result.message)
    }
  } else if (verificationRecord.code !== normalizedCode) {
    // Non-prod uses DEFAULT_OTP_CODE stored locally
    if (normalizedCode !== DEFAULT_OTP_CODE) {
      log.error(
        `Invalid OTP code for phone ${phone}, requestId: ${requestId}, expectedLength=${verificationRecord.code.length}, receivedLength=${normalizedCode.length}`,
      )
      throw new BadRequestException('Kode OTP salah')
    }
  }

  return verificationRecord
}
