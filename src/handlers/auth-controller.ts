import { env } from '@/env'
import { UnauthorizedException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { generateJwtToken, generateRefreshToken } from '@/lib/token'
import { formatPhone } from '@/lib/utils'
import {
  LoginRouteDoc,
  LogoutRouteDoc,
  RefreshTokenRouteDoc,
  RegisterRouteDoc,
} from '@/routes/auth.route'
import { validateOtp } from '@/services/otp-service'
import { AppRouteHandler } from '@/types'
import dayjs from 'dayjs'
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
      role: existingUser.role,
    })
    const refreshToken = await generateRefreshToken({
      id: existingUser.id,
      phone: existingUser.phone,
      role: existingUser.role,
    })

    await db.authToken.upsert({
      where: {
        userId: existingUser.id,
      },
      update: {
        token: token,
        refreshToken: refreshToken,
        tokenExpiresAt: dayjs().add(Number(env.jwt.expires), 'days').toDate(),
        refreshExpiresAt: dayjs()
          .add(Number(env.jwt.refreshExpires), 'days')
          .toDate(),
      },
      create: {
        userId: existingUser.id,
        token: token,
        refreshToken: refreshToken,
        tokenExpiresAt: dayjs().add(Number(env.jwt.expires), 'days').toDate(),
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
}

export const registerHandler: AppRouteHandler<RegisterRouteDoc> = async (c) => {
  try {
    const validated = c.req.valid('json')
    const { phone, code, requestId } = validated

    const formattedPhone = await formatPhone(phone)

    const token = await db.$transaction(async (tx) => {
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
          role: 'USER', // Default role, adjust as necessary
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
        role: user.role,
      })
      const refreshToken = await generateRefreshToken({
        userId: user.id,
        phone: user.phone,
        role: user.role,
      })

      await tx.authToken.create({
        data: {
          userId: user.id,
          token: token,
          refreshToken: refreshToken,
          tokenExpiresAt: dayjs().add(Number(env.jwt.expires), 'days').toDate(),
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

      return token
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
    const refreshToken = getCookie(c, 'refreshToken')

    if (!refreshToken) {
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
      deleteCookie(c, 'refreshToken')

      await db.authToken.deleteMany({
        where: { userId: authToken.user.id },
      })

      throw new UnauthorizedException()
    }

    const newToken = await generateJwtToken({
      id: authToken.user.id,
      phone: authToken.user.phone,
      role: authToken.user.role,
    })
    const newRefreshToken = await generateRefreshToken({
      id: authToken.user.id,
      phone: authToken.user.phone,
      role: authToken.user.role,
    })

    await db.authToken.update({
      where: { userId: authToken.user.id },
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
        tokenExpiresAt: dayjs().add(Number(env.jwt.expires), 'days').toDate(),
        refreshExpiresAt: dayjs()
          .add(Number(env.jwt.refreshExpires), 'days')
          .toDate(),
      },
    })

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
}
