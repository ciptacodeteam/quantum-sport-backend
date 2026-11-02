import { env, isDeployedEnv } from '@/env'
import { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

export const USER_ACCESS_TOKEN_COOKIE = 'accessToken'
export const ADMIN_ACCESS_TOKEN_COOKIE = 'adminAccessToken'
export const USER_REFRESH_TOKEN_COOKIE = 'userRefreshToken'
export const ADMIN_REFRESH_TOKEN_COOKIE = 'adminRefreshToken'
/** @deprecated Shared refresh cookie; never read for authentication. */
export const LEGACY_REFRESH_TOKEN_COOKIE = 'refreshToken'
/** @deprecated Legacy cookie name; cleared on logout */
export const LEGACY_ACCESS_TOKEN_COOKIE = 'token'

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: isDeployedEnv(),
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
  deleteCookie(c, USER_REFRESH_TOKEN_COOKIE, { path: '/' })
  deleteCookie(c, LEGACY_REFRESH_TOKEN_COOKIE, { path: '/' })
}

export function clearAdminAuthCookies(c: Context) {
  deleteCookie(c, ADMIN_ACCESS_TOKEN_COOKIE, { path: '/' })
  deleteCookie(c, ADMIN_REFRESH_TOKEN_COOKIE, { path: '/' })
  deleteCookie(c, LEGACY_REFRESH_TOKEN_COOKIE, { path: '/' })
}

function setRefreshTokenCookie(c: Context, name: string, refreshToken: string) {
  deleteCookie(c, LEGACY_REFRESH_TOKEN_COOKIE, { path: '/' })
  setCookie(c, name, refreshToken, {
    ...baseCookieOptions(),
    maxAge: Number(env.jwt.refreshExpires) * 24 * 60 * 60,
  })
}

export function setUserRefreshTokenCookie(c: Context, refreshToken: string) {
  setRefreshTokenCookie(c, USER_REFRESH_TOKEN_COOKIE, refreshToken)
}

export function setAdminRefreshTokenCookie(c: Context, refreshToken: string) {
  setRefreshTokenCookie(c, ADMIN_REFRESH_TOKEN_COOKIE, refreshToken)
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
