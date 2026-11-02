import { expect, it, vi } from 'vitest'
import { Hono } from 'hono'
vi.mock('@/env', () => ({
  env: { jwt: { expires: '1', refreshExpires: '30' } },
  isDeployedEnv: () => true,
}))
import {
  setUserRefreshTokenCookie,
  setAdminRefreshTokenCookie,
  clearUserAuthCookies,
  clearAdminAuthCookies,
} from './auth-cookies'

const app = new Hono()
app.post('/set/user', (c) => {
  setUserRefreshTokenCookie(c, 'customer-secret')
  return c.json({ success: true })
})
app.post('/set/admin', (c) => {
  setAdminRefreshTokenCookie(c, 'admin-secret')
  return c.json({ success: true })
})
app.post('/clear/user', (c) => {
  clearUserAuthCookies(c)
  return c.json({ success: true })
})
app.post('/clear/admin', (c) => {
  clearAdminAuthCookies(c)
  return c.json({ success: true })
})

it.each([
  ['user', 'userRefreshToken'],
  ['admin', 'adminRefreshToken'],
])('sets a protected %s refresh cookie', async (identity, name) => {
  const response = await app.request(`/set/${identity}`, { method: 'POST' })
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))!
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('Secure')
  expect(cookie).toContain('SameSite=Lax')
  expect(cookie).toContain('Path=/')
  expect(cookie).toContain('Max-Age=2592000')
})

it.each(['user', 'admin'])(
  'clears only %s cookies and the obsolete shared refresh cookie',
  async (identity) => {
    const response = await app.request(`/clear/${identity}`, { method: 'POST' })
    const names = response.headers
      .getSetCookie()
      .map((value) => value.split('=')[0])
    expect(names).toContain(
      identity === 'user' ? 'userRefreshToken' : 'adminRefreshToken',
    )
    expect(names).toContain('refreshToken')
    expect(names).not.toContain(
      identity === 'user' ? 'adminRefreshToken' : 'userRefreshToken',
    )
    expect(names).not.toContain(
      identity === 'user' ? 'adminAccessToken' : 'accessToken',
    )
    if (identity === 'admin') expect(names).not.toContain('token')
  },
)
