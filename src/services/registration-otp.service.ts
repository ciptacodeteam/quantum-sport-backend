import { createHash, randomBytes } from 'node:crypto'
import { PhoneVerificationType } from '@prisma/client'
import { db } from '@/lib/prisma'
import { BadRequestException } from '@/exceptions'
import { validateOtp } from './otp.service'
const invalid = () =>
  new BadRequestException(
    'Sesi aktivasi tidak valid atau sudah berakhir. Silakan minta OTP baru.',
  )
export const registrationGrantWhere = (
  phone: string,
  requestId: string,
  token: string,
) => ({
  phone,
  requestId,
  type: PhoneVerificationType.REGISTER,
  isUsed: true,
  code: createHash('sha256').update(token).digest('hex'),
  expiresAt: { gt: new Date() },
})
export async function verifyRegistrationOtp(
  phone: string,
  requestId: string,
  code: string,
) {
  const record = await validateOtp(
    phone,
    requestId,
    code,
    PhoneVerificationType.REGISTER,
  )
  const registrationToken = randomBytes(32).toString('hex')
  const claimed = await db.phoneVerification.updateMany({
    where: {
      id: record.id,
      phone,
      requestId,
      type: PhoneVerificationType.REGISTER,
      code: record.code,
      isUsed: false,
      expiresAt: { gt: new Date() },
    },
    data: {
      isUsed: true,
      code: createHash('sha256').update(registrationToken).digest('hex'),
    },
  })
  if (claimed.count !== 1) throw invalid()
  return { registrationToken }
}
export async function getRegistrationGrant(
  phone: string,
  requestId: string,
  token: string,
) {
  const record = await db.phoneVerification.findFirst({
    where: registrationGrantWhere(phone, requestId, token),
  })
  if (!record) throw invalid()
  return record
}
