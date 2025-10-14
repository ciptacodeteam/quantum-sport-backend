import { auth } from '@/lib/auth'
import { AppEnv } from '@/types'
import { Context, Next } from 'hono'

export const betterAuthMiddleware = async (c: Context<AppEnv>, next: Next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!session) {
    c.set('user', null)
    c.set('session', null)
    return next()
  }

  c.set('user', session.user)
  c.set('session', session.session)

  return next()
}

export const requireAuth = async (c: Context<AppEnv>, next: Next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!session) {
    return c.json({ message: 'Unauthorized' }, 401)
  }

  c.set('user', session.user)
  c.set('session', session.session)

  return next()
}

export const requireAdmin = async (c: Context<AppEnv>, next: Next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!session) {
    return c.json({ message: 'Unauthorized' }, 401)
  }

  if (session.user.role !== 'admin') {
    return c.json({ message: 'Forbidden' }, 403)
  }

  c.set('user', session.user)
  c.set('session', session.session)

  return next()
}

// You can add more role-based middlewares as needed
export const requireRole = (role) => {
  return async (c: Context<AppEnv>, next: Next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })

    if (!session) {
      return c.json({ message: 'Unauthorized' }, 401)
    }

    if (session.user.role !== role) {
      return c.json({ message: 'Forbidden' }, 403)
    }

    c.set('user', session.user)
    c.set('session', session.session)

    return next()
  }
}
