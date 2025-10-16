import { ForbiddenException, UnauthorizedException } from '@/exceptions'
import { validateToken } from '@/lib/token'
import { AdminTokenPayload, UserTokenPayload } from '@/types'
import { Role } from 'generated/prisma'
import { MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie } from 'hono/cookie'

export const globalAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, 'token') as string | undefined
  c.var.logger.debug(`Global auth middleware - token: ${token}`)

  if (!token) {
    c.set('user', null)

    deleteCookie(c, 'token')
    deleteCookie(c, 'refreshToken')

    return next()
  }

  const session = await validateToken(token)
  const payload = session?.data as UserTokenPayload | AdminTokenPayload | null

  if (!payload?.id) {
    c.set('user', null)

    deleteCookie(c, 'token')
    deleteCookie(c, 'refreshToken')

    return next()
  }

  // clear both contexts initially
  c.set('admin', null)
  c.set('user', null)

  // type guard to discriminate admin payloads
  const isAdminPayload = (
    p: UserTokenPayload | AdminTokenPayload | null,
  ): p is AdminTokenPayload => {
    return !!p && (p as AdminTokenPayload).role !== undefined
  }

  if (isAdminPayload(payload)) {
    c.set('admin', payload)
  } else {
    c.set('user', payload as UserTokenPayload)
  }

  return next()
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = c.get('user')

  if (!user) {
    throw new UnauthorizedException()
  }

  return next()
}

export const requireAdminAuth: MiddlewareHandler = async (c, next) => {
  const admin = c.get('admin')

  if (!admin || !admin.role) {
    throw new UnauthorizedException()
  }

  return next()
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  return requireRole('ADMIN')(c, next)
}

export const requireCoach: MiddlewareHandler = async (c, next) => {
  return requireRole('COACH')(c, next)
}

export const requireBallboy: MiddlewareHandler = async (c, next) => {
  return requireRole('BALLBOY')(c, next)
}

// You can add more role-based middlewares as needed
export const requireRole = (role: Role) => {
  const middleware: MiddlewareHandler = async (c, next) => {
    const admin = c.get('admin')

    if (!admin) {
      throw new UnauthorizedException()
    }

    if (admin.role !== role) {
      throw new ForbiddenException()
    }

    return next()
  }
  return middleware
}
