import { DEFAULT_OTP_CODE, OTP_LENGTH } from '@/constants'
import { env } from '@/env'
import { UnauthorizedException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { hashPassword, verifyPassword } from '@/lib/password'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import {
  generateJwtToken,
  generateRefreshToken,
  validateRefreshToken,
} from '@/lib/token'
import { formatPhone, generateOtp } from '@/lib/utils'
import {
  changePasswordSchema,
  ChangePasswordSchema,
  forgotPasswordSchema,
  ForgotPasswordSchema,
  loginSchema,
  LoginSchema,
  loginWithEmailSchema,
  LoginWithEmailSchema,
  PhoneSchema,
  phoneSchema,
  registerSchema,
  RegisterSchema,
  requestEmailChangeSchema,
  RequestEmailChangeSchema,
  resetPasswordSchema,
  ResetPasswordSchema,
  verifyEmailChangeSchema,
  VerifyEmailChangeSchema,
  verifyPasswordSchema,
  VerifyPasswordSchema,
} from '@/lib/validation'
import { requireAuth } from '@/middlewares/auth'
import { queueSendTemplatedEmail } from '@/services/email.service'
import { validateOtp } from '@/services/otp.service'
import { sendPhoneOtp } from '@/services/phone.service'
import { getFileUrl } from '@/services/upload.service'
import { AppRouteHandler, UserTokenPayload } from '@/types'
import { zValidator } from '@hono/zod-validator'
import { AuthTokenType, PhoneVerificationType, UserSource } from '@prisma/client'
import crypto from 'crypto'
import dayjs from 'dayjs'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import status from 'http-status'

export const checkAccountHandler = factory.createHandlers(
  zValidator('json', phoneSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as PhoneSchema
      const { phone } = validated

      const formattedPhone = await formatPhone(phone)

      const existingUser = await db.user.findUnique({
        where: { phone: formattedPhone },
      })
      const verifiedAccountExists = !!existingUser?.phoneVerified

      return c.json(
        ok(
          {
            phone: formattedPhone,
            exists: verifiedAccountExists,
          },
          verifiedAccountExists ? 'Account exists' : 'Account does not exist',
        ),
      )
    } catch (err) {
      c.var.logger.fatal(`Error during account check: ${err}`)
      throw err
    }
  },
)

export const loginHandler = factory.createHandlers(
  zValidator('json', loginSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as LoginSchema
      const { phone, password } = validated

      const formattedPhone = await formatPhone(phone)

      const existingUser = await db.user.findUnique({
        where: { phone: formattedPhone },
      })

      if (!existingUser) {
        c.var.logger.error(`No user found with phone number: ${formattedPhone}`)
        return c.json(
          err('Phone number is incorrect', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      const validPassword = await verifyPassword(
        password,
        existingUser.password!,
      )

      if (!validPassword) {
        c.var.logger.error(
          `Invalid password for phone number: ${formattedPhone}`,
        )
        return c.json(
          err('Phone number or password is incorrect', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      if (!existingUser.phoneVerified) {
        c.var.logger.warn(
          `Login blocked for unverified phone number: ${formattedPhone}`,
        )
        return c.json(
          err('WhatsApp number is not verified', status.FORBIDDEN),
          status.FORBIDDEN,
        )
      }

      // Here you would typically create a session or JWT token for the user
      const token = await generateJwtToken({
        id: existingUser.id,
        phone: existingUser.phone,
      } as UserTokenPayload)
      const refreshToken = await generateRefreshToken({
        id: existingUser.id,
        phone: existingUser.phone,
      } as UserTokenPayload)

      await db.authToken.create({
        data: {
          userId: existingUser.id,
          type: AuthTokenType.USER,
          refreshToken: refreshToken,
          refreshExpiresAt: dayjs()
            .add(Number(env.jwt.refreshExpires), 'days')
            .toDate(),
        },
      })

      setCookie(c, 'refreshToken', refreshToken, {
        httpOnly: true,
        secure: env.nodeEnv === 'production',
        sameSite: 'Lax',
        expires: dayjs().add(Number(env.jwt.refreshExpires), 'days').toDate(),
      })

      return c.json(
        ok(
          {
            token,
          },
          'Login successful',
        ),
      )
    } catch (err) {
      c.var.logger.fatal(`Error during login: ${err}`)
      throw err
    }
  },
)

export const registerHandler = factory.createHandlers(
  zValidator('json', registerSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as RegisterSchema
      const { phone, code, requestId, password, name } = validated

      const formattedPhone = await formatPhone(phone)

      const { token, refreshToken } = await db.$transaction(async (tx) => {
        const existingUser = await tx.user.findUnique({
          where: { phone: formattedPhone },
        })

        if (existingUser?.phoneVerified) {
          c.var.logger.error(
            `User already exists with phone number: ${formattedPhone}`,
          )
          throw new Error('User already exists')
        }

        await validateOtp(formattedPhone, requestId, code)

        // Mark the OTP as used
        await tx.phoneVerification.updateMany({
          where: {
            requestId,
            phone: formattedPhone,
          },
          data: {
            type: PhoneVerificationType.REGISTER,
            isUsed: true,
          },
        })

        const hashPwd = await hashPassword(password)

        const user = existingUser
          ? await tx.user.update({
              where: { id: existingUser.id },
              data: {
                name,
                password: hashPwd,
                phoneVerified: true,
              },
            })
          : await tx.user.create({
              data: {
                name,
                phone: formattedPhone,
                password: hashPwd,
                phoneVerified: true, // Phone is verified since OTP was validated during registration
                source: UserSource.ONLINE,
              },
            })

        if (!user) {
          c.var.logger.error(
            `Failed to create user with phone: ${formattedPhone}`,
          )
          throw new Error('User creation failed')
        }

        const token = await generateJwtToken({
          id: user.id,
          phone: user.phone,
        } as UserTokenPayload)
        const refreshToken = await generateRefreshToken({
          id: user.id,
          phone: user.phone,
        } as UserTokenPayload)

        await tx.authToken.create({
          data: {
            userId: user.id,
            type: AuthTokenType.USER,
            refreshToken: refreshToken,
            refreshExpiresAt: dayjs()
              .add(Number(env.jwt.refreshExpires), 'days')
              .toDate(),
          },
        })

        return {
          token,
          refreshToken,
        }
      })

      setCookie(c, 'refreshToken', refreshToken, {
        httpOnly: true,
        secure: env.nodeEnv === 'production',
        sameSite: 'Lax',
        expires: dayjs().add(Number(env.jwt.refreshExpires), 'days').toDate(),
      })

      return c.json(
        ok(
          {
            token,
          },
          'Registration successful',
        ),
        status.CREATED,
      )
    } catch (err) {
      c.var.logger.fatal(`Error during registration: ${err}`)
      throw err
    }
  },
)

export const logoutHandler = factory.createHandlers(async (c) => {
  try {
    const user = c.get('user')
    const token = getCookie(c, 'token')

    if (!token) {
      deleteCookie(c, 'token')
      deleteCookie(c, 'refreshToken')
      return c.json(ok(null, 'Logout successful'))
    }

    if (user && user.id) {
      await db.authToken.deleteMany({
        where: {
          userId: user.id,
        },
      })
    }

    deleteCookie(c, 'token')
    deleteCookie(c, 'refreshToken')

    return c.json(ok(null, 'Logout successful'))
  } catch (err) {
    c.var.logger.fatal(`Error during logout: ${err}`)
    throw err
  }
})

export const refreshTokenHandler = factory.createHandlers(async (c) => {
  try {
    const admin = c.get('admin')

    // Check if an admin token is being used on a user endpoint
    if (admin) {
      return c.json(
        err(
          'Admin detected. Please use /admin/auth/refresh-token instead',
          status.FORBIDDEN,
        ),
        status.FORBIDDEN,
      )
    }

    const refreshToken = getCookie(c, 'refreshToken')

    if (!refreshToken) {
      deleteCookie(c, 'token')
      deleteCookie(c, 'refreshToken')

      throw new UnauthorizedException()
    }

    const validRefreshToken = await validateRefreshToken(refreshToken)

    if (!validRefreshToken) {
      deleteCookie(c, 'token')
      deleteCookie(c, 'refreshToken')

      throw new UnauthorizedException()
    }

    const authToken = await db.authToken.findFirst({
      where: { refreshToken },
      include: { user: true },
    })

    if (!authToken || !authToken.user) {
      throw new UnauthorizedException()
    }

    if (dayjs().isAfter(authToken.refreshExpiresAt)) {
      deleteCookie(c, 'token')
      deleteCookie(c, 'refreshToken')

      await db.authToken.deleteMany({
        where: { userId: authToken.user.id },
      })

      throw new UnauthorizedException()
    }

    const newToken = await generateJwtToken({
      id: authToken.user.id,
      phone: authToken.user.phone,
    } as UserTokenPayload)
    const newRefreshToken = await generateRefreshToken({
      id: authToken.user.id,
      phone: authToken.user.phone,
    } as UserTokenPayload)

    await db.authToken.update({
      where: { id: authToken.id },
      data: {
        type: AuthTokenType.USER,
        refreshToken: newRefreshToken,
        refreshExpiresAt: dayjs()
          .add(Number(env.jwt.refreshExpires), 'days')
          .toDate(),
      },
    })

    deleteCookie(c, 'token')
    deleteCookie(c, 'refreshToken')

    setCookie(c, 'refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'Lax',
      expires: dayjs().add(Number(env.jwt.refreshExpires), 'days').toDate(),
    })

    return c.json(
      ok(
        {
          token: newToken,
        },
        'Token refreshed',
      ),
    )
  } catch (err) {
    c.var.logger.fatal(`Error during token refresh: ${err}`)
    throw err
  }
})

export const forgotPasswordHandler = factory.createHandlers(
  zValidator('json', forgotPasswordSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as ForgotPasswordSchema
      const { phone } = validated

      const formattedPhone = await formatPhone(phone)

      const existingUser = await db.user.findUnique({
        where: { phone: formattedPhone },
      })

      if (!existingUser) {
        c.var.logger.error(`No user found with phone number: ${formattedPhone}`)
        return c.json(
          err('Phone number is incorrect', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

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
          type: PhoneVerificationType.FORGOT_PASSWORD,
          expiresAt: dayjs().add(5, 'minute').toDate(),
        },
        create: {
          requestId,
          phone: formattedPhone,
          code,
          isUsed: false,
          type: PhoneVerificationType.FORGOT_PASSWORD,
          expiresAt: dayjs().add(5, 'minute').toDate(),
        },
      })

      return c.json(
        ok(
          {
            phone: formattedPhone,
            requestId,
          },
          'OTP sent successfully',
        ),
      )
    } catch (err) {
      c.var.logger.fatal(`Error during forgot password: ${err}`)
      throw err
    }
  },
)

export const resetPasswordHandler = factory.createHandlers(
  zValidator('json', resetPasswordSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as ResetPasswordSchema
      const { phone, requestId, newPassword } = validated

      const formattedPhone = await formatPhone(phone)

      const existingUser = await db.user.findUnique({
        where: { phone: formattedPhone },
      })

      if (!existingUser) {
        c.var.logger.error(`No user found with phone number: ${formattedPhone}`)
        return c.json(
          err('Phone number is incorrect', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      // Mark the OTP as used
      await db.phoneVerification.update({
        where: {
          requestId: requestId,
          phone: formattedPhone,
        },
        data: {
          type: PhoneVerificationType.FORGOT_PASSWORD,
          isUsed: true,
        },
      })

      // Here you would typically hash the new password before saving it
      // For demonstration purposes, we'll just log it
      c.var.logger.info(
        `Resetting password for ${formattedPhone} to ${newPassword}`,
      )

      const hashNewPassword = await hashPassword(newPassword)

      await db.user.update({
        where: { id: existingUser.id },
        data: {
          password: hashNewPassword,
        },
      })

      return c.json(ok(null, 'Password reset successful'))
    } catch (err) {
      c.var.logger.fatal(`Error during reset password: ${err}`)
      throw err
    }
  },
)

export const loginWithEmailHandler = factory.createHandlers(
  zValidator('json', loginWithEmailSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as LoginWithEmailSchema
      const { email, password } = validated

      const existingUser = await db.user.findUnique({
        where: { email },
      })

      if (!existingUser) {
        c.var.logger.error(`No user found with email: ${email}`)
        return c.json(
          err('Email or password is incorrect', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      if (!existingUser.password) {
        c.var.logger.error(`User with email ${email} has no password set`)
        return c.json(
          err('Email or password is incorrect', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      // Here you would typically verify the password
      // For demonstration purposes, we'll assume a function `verifyPassword`
      const isPasswordValid = await verifyPassword(
        password,
        existingUser.password,
      )

      if (!isPasswordValid) {
        c.var.logger.error(`Invalid password for email: ${email}`)
        return c.json(
          err('Email or password is incorrect', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      // Create a session or JWT token for the user
      const token = await generateJwtToken({
        id: existingUser.id,
        email: existingUser.email!,
      })
      const refreshToken = await generateRefreshToken({
        id: existingUser.id,
        email: existingUser.email!,
      })

      await db.authToken.create({
        data: {
          userId: existingUser.id,
          type: AuthTokenType.USER,
          refreshToken: refreshToken,
          refreshExpiresAt: dayjs()
            .add(Number(env.jwt.refreshExpires), 'days')
            .toDate(),
        },
      })

      setCookie(c, 'refreshToken', refreshToken, {
        httpOnly: true,
        secure: env.nodeEnv === 'production',
        sameSite: 'Lax',
        expires: dayjs().add(Number(env.jwt.refreshExpires), 'days').toDate(),
      })

      return c.json(
        ok(
          {
            token,
          },
          'Login successful',
        ),
      )
    } catch (err) {
      c.var.logger.fatal(`Error during login with email: ${err}`)
      throw err
    }
  },
)

export const getProfileHandler: AppRouteHandler = async (c) => {
  try {
    const user = c.get('user')
    const admin = c.get('admin')

    // Check if an admin token is being used on a user endpoint
    if (admin && !user) {
      return c.json(
        err(
          'Admin token detected. Please use /admin/auth/profile instead',
          status.FORBIDDEN,
        ),
        status.FORBIDDEN,
      )
    }

    if (!user || !user.id) {
      throw new UnauthorizedException()
    }

    const existingUser = await db.user.findUnique({
      where: { id: user.id },
      omit: {
        password: true,
      },
    })

    if (!existingUser) {
      throw new UnauthorizedException()
    }

    if (existingUser.banExpires && dayjs().isAfter(existingUser.banExpires)) {
      // Lift the ban if the ban period has expired
      await db.user.update({
        where: { id: user.id },
        data: {
          banned: false,
          banExpires: null,
          banReason: null,
        },
      })
    }

    if (existingUser.banned) {
      return c.json(
        err(
          `Your account has been banned. Reason: ${existingUser.banReason}`,
          status.FORBIDDEN,
        ),
        status.FORBIDDEN,
      )
    }

    if (existingUser.image) {
      existingUser.image = await getFileUrl(existingUser.image)
    }

    return c.json(
      ok(existingUser, 'User profile retrieved successfully'),
      status.OK,
    )
  } catch (err) {
    c.var.logger.fatal(`Error fetching user profile: ${err}`)
    throw err
  }
}

// Request email change - sends OTP to new email
export const requestEmailChangeHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', requestEmailChangeSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user') as UserTokenPayload
      if (!user?.id) {
        throw new UnauthorizedException()
      }

      const existingUser = await db.user.findUnique({
        where: { id: user.id },
      })

      if (!existingUser) {
        throw new UnauthorizedException()
      }

      const { newEmail } = c.req.valid('json') as RequestEmailChangeSchema

      // Check if new email is same as current email (only if user has email)
      if (
        existingUser.email &&
        existingUser.email.toLowerCase() === newEmail.toLowerCase()
      ) {
        return c.json(
          err(
            'New email cannot be the same as current email',
            status.BAD_REQUEST,
          ),
          status.BAD_REQUEST,
        )
      }

      // Check if email already exists for another user
      const emailExists = await db.user.findFirst({
        where: {
          email: newEmail.toLowerCase(),
          id: { not: user.id },
        },
      })

      if (emailExists) {
        return c.json(
          err('Email already in use by another account', status.CONFLICT),
          status.CONFLICT,
        )
      }

      // Generate OTP code
      const code =
        env.nodeEnv === 'production' ? await generateOtp(6) : '888888'
      const requestId = crypto.randomUUID()
      const expiresAt = dayjs().add(10, 'minutes').toDate()

      // Delete any existing pending email verification for this user
      await db.emailVerification.deleteMany({
        where: { userId: user.id },
      })

      // Create email verification record
      await db.emailVerification.create({
        data: {
          userId: user.id,
          email: newEmail.toLowerCase(),
          code,
          requestId,
          expiresAt,
        },
      })

      // Send OTP to new email
      const emailAction = existingUser.email
        ? 'change your email address'
        : 'add an email address'
      await queueSendTemplatedEmail(newEmail, 'emailVerification', {
        name: existingUser.name,
        action: emailAction,
        code,
      })

      // Send alert to old email if exists
      if (existingUser.email) {
        await queueSendTemplatedEmail(existingUser.email, 'emailChangeAlert', {
          name: existingUser.name,
          oldEmail: existingUser.email,
          newEmail,
        })
      }

      c.var.logger.info(
        `Email change OTP sent to ${newEmail} for user ${user.id}`,
      )

      return c.json(
        ok({ requestId, expiresAt }, 'OTP code sent to new email address'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in requestEmailChangeHandler: ${error}`)
      throw error
    }
  },
)

// Verify email change OTP and complete the change
export const verifyEmailChangeHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', verifyEmailChangeSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user?.id) {
        throw new UnauthorizedException()
      }

      const { requestId, code } = c.req.valid('json') as VerifyEmailChangeSchema

      // Find verification record
      const verification = await db.emailVerification.findUnique({
        where: { requestId },
      })

      if (!verification) {
        return c.json(
          err('Invalid verification request', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      // Verify user owns this request
      if (verification.userId !== user.id) {
        return c.json(
          err('Unauthorized verification request', status.FORBIDDEN),
          status.FORBIDDEN,
        )
      }

      // Check if already used
      if (verification.isUsed) {
        return c.json(
          err('Verification code has already been used', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      // Check expiration
      if (dayjs().isAfter(dayjs(verification.expiresAt))) {
        return c.json(
          err('Verification code has expired', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      // Verify code
      if (verification.code !== code) {
        return c.json(
          err('Invalid verification code', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      // Check if email is still available (double-check)
      const emailExists = await db.user.findFirst({
        where: {
          email: verification.email,
          id: { not: user.id },
        },
      })

      if (emailExists) {
        return c.json(
          err('Email is no longer available', status.CONFLICT),
          status.CONFLICT,
        )
      }

      // Update user email
      const updatedUser = await db.user.update({
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

      // Send confirmation email to new email
      const oldEmail = await db.user.findUnique({
        where: { id: user.id },
        select: { email: true },
      })
      const actionText = oldEmail?.email ? 'changed' : 'added'
      const actionTitle = oldEmail?.email
        ? 'Email Changed Successfully'
        : 'Email Added Successfully'

      await queueSendTemplatedEmail(verification.email, 'emailChangeSuccess', {
        name: updatedUser.name,
        title: actionTitle,
        action: actionText,
        email: verification.email,
      })

      c.var.logger.info(`Email changed successfully for user ${user.id}`)

      return c.json(
        ok(
          {
            email: updatedUser.email,
            emailVerified: updatedUser.emailVerified,
          },
          'Email changed successfully',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in verifyEmailChangeHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Verify user password
 * POST /auth/verify-password
 */
export const verifyUserPasswordHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', verifyPasswordSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user?.id) {
        throw new UnauthorizedException()
      }

      const { password } = c.req.valid('json') as VerifyPasswordSchema

      // Get user with password
      const userData = await db.user.findUnique({
        where: { id: user.id },
        select: { id: true, password: true },
      })

      if (!userData || !userData.password) {
        return c.json(
          err('User not found or password not set', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, userData.password)

      if (!isValidPassword) {
        return c.json(
          err('Invalid password', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      c.var.logger.info(`Password verified successfully for user ${user.id}`)

      return c.json(
        ok({ verified: true }, 'Password verified successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in verifyUserPasswordHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Change user password
 * POST /auth/change-password
 */
export const changeUserPasswordHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', changePasswordSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user?.id) {
        throw new UnauthorizedException()
      }

      const { currentPassword, newPassword } = c.req.valid(
        'json',
      ) as ChangePasswordSchema

      // Get user with password
      const userData = await db.user.findUnique({
        where: { id: user.id },
        select: { id: true, password: true, name: true, email: true },
      })

      if (!userData || !userData.password) {
        return c.json(
          err('User not found or password not set', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      // Verify current password
      const isValidPassword = await verifyPassword(
        currentPassword,
        userData.password,
      )

      if (!isValidPassword) {
        return c.json(
          err('Current password is incorrect', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      // Hash new password
      const hashedPassword = await hashPassword(newPassword)

      // Update password
      await db.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      })

      // Send confirmation email if user has email
      if (userData.email) {
        await queueSendTemplatedEmail(userData.email, 'passwordResetSuccess', {
          name: userData.name,
        })
      }

      c.var.logger.info(`Password changed successfully for user ${user.id}`)

      return c.json(
        ok({ success: true }, 'Password changed successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in changeUserPasswordHandler: ${error}`)
      throw error
    }
  },
)
