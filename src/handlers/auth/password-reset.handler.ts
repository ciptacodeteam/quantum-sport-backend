import { BadRequestException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { getValidPasswordResetToken } from '@/services/password-reset.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import z from 'zod'
import { env } from '@/env'
import { hashPassword } from '@/lib/password'

// Validation schemas
const resetPasswordWithTokenSchema = z
  .object({
    token: z.string().min(1, 'Reset token is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
      .regex(
        /[^A-Za-z0-9]/,
        'Password must contain at least one special character',
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ResetPasswordWithTokenSchema = z.infer<typeof resetPasswordWithTokenSchema>

// POST /auth/password/reset
// Reset password using token link
export const resetPasswordWithTokenHandler = factory.createHandlers(
  zValidator('json', resetPasswordWithTokenSchema, validateHook),
  async (c) => {
    try {
      const { token, newPassword } = c.req.valid(
        'json',
      ) as ResetPasswordWithTokenSchema

      // Get the reset token from database
      const resetToken = await getValidPasswordResetToken(token)

      if (!resetToken) {
        c.var.logger.warn(
          { token: token.substring(0, 10) + '...' },
          'Invalid or expired reset token',
        )
        throw new BadRequestException(
          'This password reset link is invalid or has expired. Please request a new one.',
        )
      }

      const user = resetToken.user

      // Hash the new password
      let hashedPassword: string
      try {
        hashedPassword = await hashPassword(newPassword)
      } catch (error) {
        c.var.logger.error(
          { error, userId: user.id },
          'Failed to hash password',
        )
        throw new Error('Failed to process password reset')
      }

      await db.$transaction(async (tx) => {
        const now = new Date()
        // Claim the reset link once, including when requests arrive together.
        const consumed = await tx.passwordResetToken.updateMany({
          where: {
            token,
            userId: user.id,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        })
        if (consumed.count !== 1) {
          throw new BadRequestException(
            'This password reset link is invalid or has expired. Please request a new one.',
          )
        }
        await tx.user.update({
          where: { id: user.id },
          data: { password: hashedPassword },
        })
        await tx.authToken.deleteMany({ where: { userId: user.id } })
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: now },
        })
      })

      c.var.logger.info(
        { userId: user.id, email: user.email },
        'Password reset successfully via token',
      )

      // Queue notification email
      try {
        const { queueEmail } = await import('@/services/email-queue.service')
        const userEmail = resetToken.user.email
        if (userEmail) {
          await queueEmail({
            to: userEmail,
            subject: 'Password Changed Successfully',
            template: 'passwordResetSuccess',
            variables: {
              name: user.name,
              message: 'Your password has been successfully changed.',
              actionUrl: `${env.frontEndUrl.replace(/\/+$/, '')}/?login=true`,
            },
          })
        }
      } catch (emailError) {
        c.var.logger.warn(
          { emailError },
          'Failed to queue password change notification',
        )
        // Don't fail the request if email notification fails
      }

      return c.json(
        ok(
          {
            userId: user.id,
            email: user.email,
            message: 'Password has been reset successfully',
          },
          'Password reset successful',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.error(`Error in resetPasswordWithTokenHandler: ${error}`)
      throw error
    }
  },
)

// GET /auth/password/reset/verify
// Verify if reset token is valid
export const verifyResetTokenHandler = factory.createHandlers(
  zValidator('query', z.object({ token: z.string() }), validateHook),
  async (c) => {
    try {
      const { token } = c.req.valid('query')

      const resetToken = await getValidPasswordResetToken(token)

      if (!resetToken) {
        return c.json(
          ok(
            { valid: false, message: 'Invalid or expired reset token' },
            'Token is invalid or expired',
          ),
          status.UNAUTHORIZED,
        )
      }

      return c.json(
        ok(
          {
            valid: true,
            userId: resetToken.userId,
            userName: resetToken.user.name,
            expiresAt: resetToken.expiresAt,
            message: 'Reset token is valid',
          },
          'Token is valid',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.error(`Error in verifyResetTokenHandler: ${error}`)
      throw error
    }
  },
)

// POST /auth/password/request-reset
// Request password reset (for public endpoint without admin)
export const requestPasswordResetHandler = factory.createHandlers(
  zValidator('json', z.object({ email: z.string().email() }), validateHook),
  async (c) => {
    try {
      const { email } = c.req.valid('json')

      const user = await db.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          phone: true,
          phoneVerified: true,
        },
      })

      // Don't reveal if user exists (security best practice)
      if (!user) {
        return c.json(
          ok(
            {
              message:
                'If an account exists with this email, a reset link has been sent',
            },
            'Password reset requested',
          ),
          status.OK,
        )
      }

      // Validate user has verified email
      if (!user.emailVerified) {
        c.var.logger.warn(
          { userId: user.id, email },
          'Password reset requested but email not verified',
        )
        return c.json(
          ok(
            {
              message:
                'If an account exists with this email, a reset link has been sent',
            },
            'Password reset requested',
          ),
          status.OK,
        )
      }

      // Create reset token
      const { createPasswordResetToken, buildPasswordResetLink } =
        await import('@/services/password-reset.service')

      const { token, expiresIn } = await createPasswordResetToken(user.id)
      const resetLink = buildPasswordResetLink(token, env.frontEndUrl)

      // Queue email (email is guaranteed to exist if emailVerified is true)
      const { queueEmail } = await import('@/services/email-queue.service')
      if (user.email) {
        await queueEmail({
          to: user.email,
          subject: 'Reset Your Password',
          template: 'passwordReset',
          variables: {
            name: user.name,
            resetLink,
            expiresIn,
            actionUrl: resetLink,
          },
        })
      }

      c.var.logger.info(
        { userId: user.id, email },
        'Password reset email queued for user',
      )

      // Return generic success message for security
      return c.json(
        ok(
          {
            message:
              'If an account exists with this email, a reset link has been sent',
          },
          'Password reset requested',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.error(`Error in requestPasswordResetHandler: ${error}`)
      throw error
    }
  },
)
