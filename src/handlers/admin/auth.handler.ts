import { env } from '@/env'
import { UnauthorizedException } from '@/exceptions'
import { hashPassword, verifyPassword } from '@/lib/password'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { generateJwtToken } from '@/lib/token'
import {
  AdminLoginRouteDoc,
  AdminLogoutRouteDoc,
  AdminProfileRouteDoc,
  AdminRegisterAdminRouteDoc,
} from '@/routes/admin/auth.route'
import { getFilePath } from '@/services/upload.service'
import { AdminTokenPayload, AppRouteHandler } from '@/types'
import dayjs from 'dayjs'
import { AuthTokenType, Role } from 'generated/prisma'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import status from 'http-status'

export const adminRegisterHandler: AppRouteHandler<
  AdminRegisterAdminRouteDoc
> = async (c) => {
  try {
    const validated = c.req.valid('json')
    const { name, email, password } = validated

    const existingAdmin = await db.staff.findFirst({
      where: { role: Role.ADMIN },
    })

    if (existingAdmin) {
      c.var.logger.debug(
        'Admin registration attempt when an admin already exists',
      )
      return c.json(err('An admin user already exists'), status.CONFLICT)
    }

    const hashedPassword = await hashPassword(password)

    const newAdmin = await db.staff.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: Role.ADMIN,
        joinedAt: dayjs().toDate(),
        isActive: true,
      },
    })

    c.var.logger.info(`New admin registered with email: ${email}`)

    const token = await generateJwtToken({
      id: newAdmin.id,
      name: newAdmin.name,
      email: newAdmin.email,
      role: newAdmin.role,
    } as AdminTokenPayload)

    const refreshToken = await generateJwtToken({
      id: newAdmin.id,
      name: newAdmin.name,
      email: newAdmin.email,
      role: newAdmin.role,
    } as AdminTokenPayload)

    await db.authToken.create({
      data: {
        staffId: newAdmin.id,
        type: AuthTokenType.STAFF,
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

    return c.json(ok(null, 'Admin registered successfully'), status.CREATED)
  } catch (err) {
    c.var.logger.fatal(`Error in registerAdminHandler: ${err}`)
    throw err
  }
}

export const adminLoginHandler: AppRouteHandler<AdminLoginRouteDoc> = async (
  c,
) => {
  try {
    const validated = c.req.valid('json')
    const { email, password } = validated

    const user = await db.staff.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        password: true,
        role: true,
        isActive: true,
      },
    })

    if (!user) {
      c.var.logger.error(`Login attempt failed for email: ${email}`)
      return c.json(err('Invalid email or password'), status.UNAUTHORIZED)
    }

    const isPasswordValid = await verifyPassword(password, user.password)

    if (!isPasswordValid) {
      c.var.logger.error(`Login attempt failed for email: ${email}`)
      return c.json(err('Invalid email or password'), status.UNAUTHORIZED)
    }

    const token = await generateJwtToken({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    } as AdminTokenPayload)

    const refreshToken = await generateJwtToken({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    } as AdminTokenPayload)

    await db.authToken.create({
      data: {
        staffId: user.id,
        type: AuthTokenType.STAFF,
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

    return c.json(ok(null, 'Login successful'), status.OK)
  } catch (err) {
    c.var.logger.fatal(`Error in adminLoginHandler: ${err}`)
    throw err
  }
}

export const adminLogoutHandler: AppRouteHandler<AdminLogoutRouteDoc> = async (
  c,
) => {
  try {
    const admin = c.get('admin')
    const token = getCookie(c, 'token')

    if (!token) {
      deleteCookie(c, 'token')
      deleteCookie(c, 'refreshToken')
      return c.json(ok(null, 'Logout successful'))
    }

    if (admin && admin.id) {
      await db.authToken.deleteMany({
        where: {
          staffId: admin.id,
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

export const adminProfileHandler: AppRouteHandler<
  AdminProfileRouteDoc
> = async (c) => {
  try {
    const admin = c.get('admin')

    if (!admin || !admin.id) {
      throw new UnauthorizedException()
    }

    const adminData = await db.staff.findUnique({
      where: { id: admin.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        image: true,
        createdAt: true,
        role: true,
        isActive: true,
        joinedAt: true,
      },
    })

    if (!adminData) {
      throw new UnauthorizedException()
    }

    if (adminData.image) {
      const imageUrl = await getFilePath(adminData.image)
      adminData.image = imageUrl
    }

    return c.json(ok(adminData, 'Profile fetched successfully'), status.OK)
  } catch (err) {
    c.var.logger.fatal(`Error in getProfileHandler: ${err}`)
    throw err
  }
}
