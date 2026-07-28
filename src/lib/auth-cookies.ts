import { env } from '@/env'
import { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

export const USER_ACCESS_TOKEN_COOKIE = 'accessToken'
export const ADMIN_ACCESS_TOKEN_COOKIE = 'adminAccessToken'
/** @deprecated Legacy cookie name; cleared on logout */
export const LEGACY_ACCESS_TOKEN_COOKIE = 'token'

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'Lax' as const,
    path: '/',
  }
}

export function setUserAccessTokenCookie(c: Context, accessToken: string) {
  setCookie(c, USER_ACCESS_TOKEN_COOKIE, accessToken, {
    ...baseCookieOptions(),
    maxAge: Number(env.jwt.expires) * 60,
  })
}

export function setAdminAccessTokenCookie(c: Context, accessToken: string) {
  setCookie(c, ADMIN_ACCESS_TOKEN_COOKIE, accessToken, {
    ...baseCookieOptions(),
    maxAge: Number(env.jwt.expires) * 60,
  })
}

export function clearUserAuthCookies(c: Context) {
  deleteCookie(c, USER_ACCESS_TOKEN_COOKIE, { path: '/' })
  deleteCookie(c, LEGACY_ACCESS_TOKEN_COOKIE, { path: '/' })
  deleteCookie(c, 'refreshToken', { path: '/' })
}

export function clearAdminAuthCookies(c: Context) {
  deleteCookie(c, ADMIN_ACCESS_TOKEN_COOKIE, { path: '/' })
  deleteCookie(c, LEGACY_ACCESS_TOKEN_COOKIE, { path: '/' })
  deleteCookie(c, 'refreshToken', { path: '/' })
}

export function resolveAccessTokenFromRequest(c: Context): string | null {
  const authorization = c.req.header('Authorization')
  if (authorization?.startsWith('Bearer ')) {
    return authorization.replace('Bearer ', '')
  }

  const isAdminRoute = c.req.path.startsWith('/admin')
  const cookieName = isAdminRoute
    ? ADMIN_ACCESS_TOKEN_COOKIE
    : USER_ACCESS_TOKEN_COOKIE

  const fromCookie = getCookie(c, cookieName)
  if (fromCookie) return fromCookie

  // Fallback for non-admin routes if only admin cookie is present (rare)
  if (!isAdminRoute) {
    return getCookie(c, LEGACY_ACCESS_TOKEN_COOKIE) ?? null
  }

  return null
}
