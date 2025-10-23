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
  resetPasswordSchema,
  ResetPasswordSchema,
} from '@/lib/validation'
import { validateOtp } from '@/services/otp.service'
import { sendPhoneOtp } from '@/services/phone.service'
import { getFileUrl } from '@/services/upload.service'
import { AppRouteHandler, UserTokenPayload } from '@/types'
import { zValidator } from '@hono/zod-validator'
import dayjs from 'dayjs'
import { AuthTokenType, PhoneVerificationType } from 'generated/prisma'
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

      return c.json(
        ok(
          {
            phone: formattedPhone,
            exists: !!existingUser,
          },
          existingUser ? 'Account exists' : 'Account does not exist',
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

        if (existingUser) {
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

        const user = await tx.user.create({
          data: {
            name,
            phone: formattedPhone,
            password: hashPwd,
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
    const refreshToken = getCookie(c, 'refreshToken')

    if (!refreshToken) {
      throw new UnauthorizedException()
    }

    const validRefreshToken = await validateRefreshToken(refreshToken)

    if (!validRefreshToken) {
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
