import { createHash, randomBytes } from 'node:crypto'
import { PhoneVerificationType } from '@prisma/client'
import { BadRequestException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { hashPassword } from '@/lib/password'
import { validateOtp } from '@/services/otp.service'

const invalidReset = () =>
  new BadRequestException(
    'Sesi reset tidak valid atau sudah berakhir. Silakan minta OTP baru.',
  )
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex')

export async function verifyPasswordResetOtp(
  phone: string,
  requestId: string,
  code: string,
) {
  const record = await validateOtp(
    phone,
    requestId,
    code,
    PhoneVerificationType.FORGOT_PASSWORD,
  )
  const resetToken = randomBytes(32).toString('hex')

  // Retain only a digest of the reset capability. A resend replaces this row,
  // invalidating any capability issued for the previous request.
  const claimed = await db.phoneVerification.updateMany({
    where: {
      id: record.id,
      phone,
      requestId,
      type: PhoneVerificationType.FORGOT_PASSWORD,
      code: record.code,
      isUsed: false,
      expiresAt: { gt: new Date() },
    },
    data: { isUsed: true, code: tokenHash(resetToken) },
  })
  if (claimed.count !== 1) throw invalidReset()
  return { resetToken }
}

export async function resetPasswordWithOtpToken(
  phone: string,
  requestId: string,
  resetToken: string,
  newPassword: string,
) {
  const where = {
    phone,
    requestId,
    type: PhoneVerificationType.FORGOT_PASSWORD,
    code: tokenHash(resetToken),
    isUsed: true,
    expiresAt: { gt: new Date() },
  }
  // Reject invalid capabilities before performing an expensive password hash.
  if (!(await db.phoneVerification.findFirst({ where, select: { id: true } })))
    throw invalidReset()
  const password = await hashPassword(newPassword)

  await db.$transaction(async (tx) => {
    // Conditional deletion serializes concurrent submissions. A failed password
    // update rolls this deletion back so the customer can retry safely.
    const consumed = await tx.phoneVerification.deleteMany({
      where: { ...where, expiresAt: { gt: new Date() } },
    })
    if (consumed.count !== 1) throw invalidReset()
    const user = await tx.user.update({ where: { phone }, data: { password } })
    await tx.authToken.deleteMany({ where: { userId: user.id } })
  })
}
