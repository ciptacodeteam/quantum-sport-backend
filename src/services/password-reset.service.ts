import { db } from '@/lib/prisma'
import { log } from '@/lib/logger'
import dayjs from 'dayjs'
import crypto from 'crypto'

/**
 * Password reset token expiry (in hours)
 */
const PASSWORD_RESET_EXPIRY = 24

/**
 * Generate a secure password reset token
 */
export const generatePasswordResetToken = (): string => {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Create a password reset record in the database
 */
export const createPasswordResetToken = async (userId: string) => {
  try {
    const token = generatePasswordResetToken()
    const expiresAt = dayjs().add(PASSWORD_RESET_EXPIRY, 'hour').toDate()

    // Store token in database
    await db.passwordResetToken.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    })

    log.info(
      { userId },
      `Password reset token created (expires in ${PASSWORD_RESET_EXPIRY} hours)`,
    )

    return {
      token,
      expiresAt,
      expiresIn: `${PASSWORD_RESET_EXPIRY} hours`,
    }
  } catch (error) {
    log.error({ error, userId }, 'Failed to create password reset token')
    throw error
  }
}

/**
 * Build password reset link
 */
export const buildPasswordResetLink = (
  token: string,
  baseUrl: string,
): string => {
  return `${baseUrl.replace(/\/+$/, '')}/reset-password?token=${token}`
}

/**
 * Verify password reset token
 */
export const verifyPasswordResetToken = async (
  token: string,
  userId: string,
) => {
  try {
    const resetToken = await db.passwordResetToken.findUnique({
      where: { token },
    })

    if (!resetToken) {
      log.warn(
        { token: token.substring(0, 10) + '...', userId },
        'Password reset token not found',
      )
      return false
    }

    if (resetToken.userId !== userId) {
      log.warn(
        { token: token.substring(0, 10) + '...', userId },
        'Password reset token user mismatch',
      )
      return false
    }

    if (resetToken.expiresAt <= new Date()) {
      log.warn(
        { token: token.substring(0, 10) + '...', userId },
        'Password reset token expired',
      )
      return false
    }

    if (resetToken.usedAt) {
      log.warn(
        { token: token.substring(0, 10) + '...', userId },
        'Password reset token already used',
      )
      return false
    }

    log.info({ userId }, 'Password reset token verified successfully')
    return true
  } catch (error) {
    log.error({ error }, 'Failed to verify password reset token')
    return false
  }
}

/**
 * Read-only token preflight. The reset transaction must recheck and consume it.
 */
export const getValidPasswordResetToken = async (token: string) => {
  try {
    const resetToken = await db.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!resetToken) {
      return null
    }

    // Check if token is expired
    if (resetToken.expiresAt <= new Date()) {
      return null
    }

    // Check if token was already used
    if (resetToken.usedAt) {
      return null
    }

    return resetToken
  } catch (error) {
    log.error({ error }, 'Failed to get password reset token')
    return null
  }
}
