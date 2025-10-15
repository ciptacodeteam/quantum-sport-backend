import { OTP_LENGTH } from '@/constants'
import { env } from '@/env'
import { UnauthorizedException } from '@/exceptions'
import { hashPassword } from '@/lib/password'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import {
  generateJwtToken,
  generateRefreshToken,
  validateRefreshToken,
  validateToken,
} from '@/lib/token'
import { formatPhone, generateOtp } from '@/lib/utils'
import {
  ForgotPasswordRouteDoc,
  LoginRouteDoc,
  LogoutRouteDoc,
  RefreshTokenRouteDoc,
  RegisterRouteDoc,
  ResetPasswordRouteDoc,
} from '@/routes/auth.route'
import { validateOtp } from '@/services/otp-service'
import { sendPhoneOtp, verifyPhoneOtp } from '@/services/phone-service'
import { AppRouteHandler } from '@/types'
import dayjs from 'dayjs'
import { AuthTokenType, PhoneVerificationType } from 'generated/prisma'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import status from 'http-status'

export const loginHandler: AppRouteHandler<LoginRouteDoc> = async (c) => {
  try {
    const validated = c.req.valid('json')
    const { phone, code, requestId } = validated

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

    const validOtp = await validateOtp(formattedPhone, requestId, code)

    if (env.nodeEnv === 'production') {
      const successVerifyOtp = await verifyPhoneOtp(requestId, code)

      if (!successVerifyOtp) {
        c.var.logger.error(
          `Failed to verify OTP for phone number: ${formattedPhone}`,
        )
        return c.json(
          err('Failed to verify OTP', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }
    }

    // Mark the OTP as used
    await db.phoneVerification.update({
      where: {
        id: validOtp.id,
      },
      data: {
        isUsed: true,
      },
    })

    // Here you would typically create a session or JWT token for the user
    const token = await generateJwtToken({
      id: existingUser.id,
      phone: existingUser.phone,
    })
    const refreshToken = await generateRefreshToken({
      id: existingUser.id,
      phone: existingUser.phone,
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

    setCookie(c, 'token', token, {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'Lax',
    })
    setCookie(c, 'refreshToken', refreshToken, {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'Lax',
    })

    return c.json(ok(null, 'Login successful'))
  } catch (err) {
    c.var.logger.fatal(`Error during login: ${err}`)
    throw err
  }
}

export const registerHandler: AppRouteHandler<RegisterRouteDoc> = async (c) => {
  try {
    const validated = c.req.valid('json')
    const { phone, code, requestId } = validated

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
          isUsed: true,
        },
      })

      const user = await tx.user.create({
        data: {
          phone: formattedPhone,
          name: 'New User', // Default name, you might want to change this
        },
      })

      if (!user) {
        c.var.logger.error(
          `Failed to create user with phone: ${formattedPhone}`,
        )
        throw new Error('User creation failed')
      }

      const token = await generateJwtToken({
        userId: user.id,
        phone: user.phone,
      })
      const refreshToken = await generateRefreshToken({
        userId: user.id,
        phone: user.phone,
      })

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

    setCookie(c, 'token', token, {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'Lax',
    })
    setCookie(c, 'refreshToken', refreshToken, {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'Lax',
    })

    return c.json(ok(null, 'Registration successful'), status.CREATED)
  } catch (err) {
    c.var.logger.fatal(`Error during registration: ${err}`)
    throw err
  }
}

export const logoutHandler: AppRouteHandler<LogoutRouteDoc> = async (c) => {
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
}

export const refreshTokenHandler: AppRouteHandler<
  RefreshTokenRouteDoc
> = async (c) => {
  try {
    const token = getCookie(c, 'token')
    const refreshToken = getCookie(c, 'refreshToken')

    if (!refreshToken) {
      throw new UnauthorizedException()
    }

    // If the token is still valid, no need to refresh
    if (token) {
      const validatedToken = await validateToken(token)

      if (validatedToken) {
        setCookie(c, 'token', token, {
          httpOnly: true,
          secure: env.nodeEnv === 'production',
          sameSite: 'Lax',
        })

        setCookie(c, 'refreshToken', refreshToken, {
          httpOnly: true,
          secure: env.nodeEnv === 'production',
          sameSite: 'Lax',
        })

        return c.json(ok(null, 'Token is still valid'))
      }
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
    })
    const newRefreshToken = await generateRefreshToken({
      id: authToken.user.id,
      phone: authToken.user.phone,
    })

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

    setCookie(c, 'token', newToken, {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'Lax',
    })
    setCookie(c, 'refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'Lax',
    })

    return c.json(ok(null, 'Token refreshed'))
  } catch (err) {
    c.var.logger.fatal(`Error during token refresh: ${err}`)
    throw err
  }
}

export const forgotPasswordHandler: AppRouteHandler<
  ForgotPasswordRouteDoc
> = async (c) => {
  try {
    const validated = c.req.valid('json')
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

    // Here you would typically initiate the forgot password process,
    // such as sending a password reset email or SMS.
    const otp = await generateOtp(OTP_LENGTH)
    c.var.logger.info(`Generated OTP for ${formattedPhone}: ${otp}`)

    const requestId = await sendPhoneOtp(formattedPhone, otp)

    if (!requestId) {
      c.var.logger.error(
        `Failed to send OTP to phone number: ${formattedPhone}`,
      )
      return c.json(
        err('Failed to send OTP', status.INTERNAL_SERVER_ERROR),
        status.INTERNAL_SERVER_ERROR,
      )
    }

    await db.phoneVerification.create({
      data: {
        phone: formattedPhone,
        requestId,
        code: otp,
        type: PhoneVerificationType.FORGOT_PASSWORD,
        isUsed: false,
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
}

export const resetPasswordHandler: AppRouteHandler<
  ResetPasswordRouteDoc
> = async (c) => {
  try {
    const validated = c.req.valid('json')
    const { phone, code, requestId, newPassword } = validated

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

    await validateOtp(formattedPhone, requestId, code)

    if (env.nodeEnv === 'production') {
      const successVerifyOtp = await verifyPhoneOtp(requestId, code)

      if (!successVerifyOtp) {
        c.var.logger.error(
          `Failed to verify OTP for phone number: ${formattedPhone}`,
        )
        return c.json(
          err('Failed to verify OTP', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }
    }

    const validOtp = await db.phoneVerification.findFirst({
      where: {
        requestId,
        phone: formattedPhone,
        code,
        type: PhoneVerificationType.FORGOT_PASSWORD,
        isUsed: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    })

    if (!validOtp) {
      c.var.logger.error(
        `Invalid or expired OTP for phone number: ${formattedPhone}`,
      )
      return c.json(
        err('Invalid or expired OTP', status.BAD_REQUEST),
        status.BAD_REQUEST,
      )
    }

    // Mark the OTP as used
    await db.phoneVerification.update({
      where: {
        id: validOtp.id,
      },
      data: {
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
}
