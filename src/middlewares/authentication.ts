import { ForbiddenException, UnauthorizedException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { validateToken } from '@/lib/token'
import { AppBinding, AppMiddleware } from '@/types'
import { Role } from 'generated/prisma'
import { Context, Next } from 'hono'
import { deleteCookie } from 'hono/cookie'

type SessionData = {
  id: string
  email: string
  role: Role
}

export const globalAuthMiddleware: AppMiddleware = async (c, next) => {
  const authorization = c.req.header('Authorization') as string | undefined
  const token = authorization?.replace('Bearer ', '')

  if (!token) {
    c.set('user', null)

    deleteCookie(c, 'refreshToken')

    return next()
  }

  const session = await validateToken(token)
  const user = session?.data as SessionData | null

  if (!user?.id) {
    c.set('user', null)

    deleteCookie(c, 'refreshToken')

    return next()
  }

  const userData = await db.user.findUnique({
    where: { id: user.id },
  })

  if (!userData) {
    c.set('user', null)
    return next()
  }

  c.set('user', userData)

  return next()
}

export const requireAuth: AppMiddleware = async (c, next) => {
  const user = c.get('user')

  if (!user) {
    throw new UnauthorizedException()
  }

  return next()
}

export const requireAdmin: AppMiddleware = async (c, next) => {
  return requireRole('ADMIN')(c, next)
}

export const requireUser: AppMiddleware = async (c, next) => {
  return requireRole('USER')(c, next)
}

export const requireCoach: AppMiddleware = async (c, next) => {
  return requireRole('COACH')(c, next)
}

export const requireBallboy: AppMiddleware = async (c, next) => {
  return requireRole('BALLBOY')(c, next)
}

// You can add more role-based middlewares as needed
export const requireRole = (role: Role) => {
  return async (c: Context<AppBinding>, next: Next) => {
    const user = c.get('user')

    if (!user) {
      throw new UnauthorizedException()
    }

    if (user.role !== role) {
      throw new ForbiddenException()
    }

    return next()
  }
}
