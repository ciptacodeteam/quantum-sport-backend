import { ForbiddenException, UnauthorizedException } from '@/exceptions'
import { validateToken } from '@/lib/token'
import { AdminTokenPayload } from '@/types'
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
  const user = session?.data as AdminTokenPayload | null

  if (!user?.id) {
    c.set('user', null)

    deleteCookie(c, 'token')
    deleteCookie(c, 'refreshToken')

    return next()
  }

  c.set('admin', null)

  if (user && user?.role) {
    c.set('admin', user)
  }

  c.set('user', user)

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
