import { ForbiddenException, UnauthorizedException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { validateToken } from '@/lib/token'
import { AppEnv } from '@/types'
import { Role } from 'generated/prisma'
import { Context, Next } from 'hono'
import { deleteCookie } from 'hono/cookie'

type SessionData = {
  id: string
  email: string
  role: Role
}

export const globalAuthMiddleware = async (c: Context<AppEnv>, next: Next) => {
  const authorization = c.req.header('authorization') as string | undefined
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

export const requireAuth = async (c: Context<AppEnv>, next: Next) => {
  const user = c.get('user')

  if (!user) {
    throw new UnauthorizedException()
  }

  return next()
}

export const requireAdmin = async (c: Context<AppEnv>, next: Next) => {
  return requireRole('ADMIN')(c, next)
}

export const requireUser = async (c: Context<AppEnv>, next: Next) => {
  return requireRole('USER')(c, next)
}

export const requireCoach = async (c: Context<AppEnv>, next: Next) => {
  return requireRole('COACH')(c, next)
}

export const requireBallboy = async (c: Context<AppEnv>, next: Next) => {
  return requireRole('BALLBOY')(c, next)
}

// You can add more role-based middlewares as needed
export const requireRole = (role: Role) => {
  return async (c: Context<AppEnv>, next: Next) => {
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
