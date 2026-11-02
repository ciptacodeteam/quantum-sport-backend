import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '@/types'
import { resolveAccessTokenFromRequest } from '@/lib/auth-cookies'

const mocks = vi.hoisted(() => ({
  userFind: vi.fn(),
  staffFind: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  generateAccess: vi.fn(),
  generateRefresh: vi.fn(),
  validateRefresh: vi.fn(),
  log: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: { findUnique: mocks.userFind },
    staff: { findUnique: mocks.staffFind },
    authToken: {
      create: mocks.create,
      findFirst: mocks.find,
      update: mocks.update,
      deleteMany: mocks.remove,
    },
  },
}))
vi.mock('@/lib/token', () => ({
  generateJwtToken: mocks.generateAccess,
  generateRefreshToken: mocks.generateRefresh,
  validateRefreshToken: mocks.validateRefresh,
}))
vi.mock('@/lib/password', () => ({
  verifyPassword: vi.fn().mockResolvedValue(true),
  hashPassword: vi.fn(),
}))
vi.mock('@/services/account-status.service', () => ({
  assertUserNotBanned: vi.fn(),
  assertStaffActive: vi.fn(),
}))
vi.mock('@/services/upload.service', () => ({
  getFileUrl: vi.fn(),
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
}))
vi.mock('@/services/email.service', () => ({
  queueSendTemplatedEmail: vi.fn(),
}))
vi.mock('@/services/phone.service', () => ({
  sendPhoneOtp: vi.fn(),
  verifyPhoneOtp: vi.fn(),
}))
import {
  loginHandler,
  refreshTokenHandler,
  logoutHandler,
} from './auth.handler'
import {
  loginAdminHandler,
  refreshTokenAdminHandler,
  logoutAdminHandler,
} from './admin/auth.handler'

const user = {
  id: 'customer',
  phone: '+6281234567890',
  password: 'hash',
  phoneVerified: true,
}
const admin = {
  id: 'admin',
  email: 'admin@example.com',
  password: 'hash',
  role: 'ADMIN',
  isActive: true,
  branch: { isActive: true },
}
type Session = {
  id: string
  refreshToken: string
  userId?: string
  staffId?: string
  type: string
  refreshExpiresAt: Date
}
let sessions: Session[]
let sequence: number
const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  const token = resolveAccessTokenFromRequest(c)
  c.set(
    'user',
    token === 'customer-access' ? { id: user.id, phone: user.phone } : null,
  )
  c.set(
    'admin',
    token === 'admin-access'
      ? { id: admin.id, email: admin.email, role: 'ADMIN' }
      : null,
  )
  c.set('logger', {
    fatal: mocks.log,
    info: mocks.log,
    warn: mocks.log,
    error: mocks.log,
  } as never)
  await next()
})
app.post('/auth/login', ...loginHandler)
app.post('/auth/refresh-token', ...refreshTokenHandler)
app.post('/auth/logout', ...logoutHandler)
app.post('/admin/auth/login', ...loginAdminHandler)
app.post('/admin/auth/refresh-token', ...refreshTokenAdminHandler)
app.post('/admin/auth/logout', ...logoutAdminHandler)

beforeEach(() => {
  vi.clearAllMocks()
  sessions = []
  sequence = 0
  mocks.userFind.mockResolvedValue(user)
  mocks.staffFind.mockResolvedValue(admin)
  mocks.generateAccess.mockImplementation(async (payload) =>
    payload.role ? 'admin-access' : 'customer-access',
  )
  mocks.generateRefresh.mockImplementation(
    async (payload) =>
      `${payload.role ? 'admin' : 'customer'}-refresh-${++sequence}`,
  )
  mocks.validateRefresh.mockResolvedValue({ type: 'refresh' })
  mocks.create.mockImplementation(async ({ data }) => {
    const row = { ...data, id: String(sequence) }
    sessions.push(row)
    return row
  })
  mocks.find.mockImplementation(async ({ where }) => {
    const row = sessions.find(
      (session) => session.refreshToken === where.refreshToken,
    )
    return row
      ? {
          ...row,
          user: row.userId ? user : null,
          staff: row.staffId ? admin : null,
        }
      : null
  })
  mocks.update.mockImplementation(async ({ where, data }) => {
    const row = sessions.find((session) => session.id === where.id)!
    Object.assign(row, data)
    return row
  })
  mocks.remove.mockImplementation(async ({ where }) => {
    sessions = sessions.filter(
      (session) =>
        !Object.entries(where).every(
          ([key, value]) => session[key as keyof Session] === value,
        ),
    )
    return { count: 1 }
  })
})

function browser() {
  const cookies = new Map<string, string>()
  return {
    cookies,
    async post(path: string, payload = {}) {
      const response = await app.request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: [...cookies]
            .map(([name, value]) => `${name}=${value}`)
            .join('; '),
        },
        body: JSON.stringify(payload),
      })
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(';'),
          index = pair.indexOf('=')
        const name = pair.slice(0, index),
          value = pair.slice(index + 1)
        if (!value || /Max-Age=0/i.test(header)) cookies.delete(name)
        else cookies.set(name, value)
      }
      return response
    },
  }
}

const customerLogin = (b: ReturnType<typeof browser>) =>
  b.post('/auth/login', { phone: user.phone, password: 'Password123!' })
const adminLogin = (b: ReturnType<typeof browser>) =>
  b.post('/admin/auth/login', { email: admin.email, password: 'Password123!' })

describe('independent browser refresh sessions', () => {
  it.each(['customer-first', 'admin-first'])(
    'keeps both logins and refreshes independent (%s)',
    async (order) => {
      const b = browser()
      const first = order === 'customer-first' ? customerLogin : adminLogin
      const second = order === 'customer-first' ? adminLogin : customerLogin
      expect((await first(b)).status).toBe(200)
      expect((await second(b)).status).toBe(200)
      expect(b.cookies.has('userRefreshToken')).toBe(true)
      expect(b.cookies.has('adminRefreshToken')).toBe(true)
      expect(b.cookies.has('refreshToken')).toBe(false)
      const adminBefore = b.cookies.get('adminRefreshToken')
      const userBefore = b.cookies.get('userRefreshToken')
      expect((await b.post('/auth/refresh-token')).status).toBe(200)
      expect(b.cookies.get('adminRefreshToken')).toBe(adminBefore)
      expect(b.cookies.get('userRefreshToken')).not.toBe(userBefore)
      const userAfter = b.cookies.get('userRefreshToken')
      expect((await b.post('/admin/auth/refresh-token')).status).toBe(200)
      expect(b.cookies.get('userRefreshToken')).toBe(userAfter)
      expect(b.cookies.get('adminRefreshToken')).not.toBe(adminBefore)
    },
  )

  it.each(['customer', 'admin'])(
    'logging out %s leaves the other session refreshable',
    async (identity) => {
      const b = browser()
      await customerLogin(b)
      await adminLogin(b)
      const userBefore = b.cookies.get('userRefreshToken'),
        adminBefore = b.cookies.get('adminRefreshToken')
      const ownPath = identity === 'customer' ? '/auth' : '/admin/auth'
      const otherPath = identity === 'customer' ? '/admin/auth' : '/auth'
      expect((await b.post(`${ownPath}/logout`)).status).toBe(200)
      if (identity === 'customer') {
        expect(b.cookies.has('userRefreshToken')).toBe(false)
        expect(b.cookies.get('adminRefreshToken')).toBe(adminBefore)
      } else {
        expect(b.cookies.has('adminRefreshToken')).toBe(false)
        expect(b.cookies.get('userRefreshToken')).toBe(userBefore)
      }
      expect((await b.post(`${otherPath}/refresh-token`)).status).toBe(200)
      expect((await b.post(`${ownPath}/refresh-token`)).status).toBe(401)
    },
  )

  it.each(['/auth', '/admin/auth'])(
    'does not accept the old shared refresh cookie at %s',
    async (path) => {
      const b = browser()
      b.cookies.set('refreshToken', 'old-shared-token')
      expect((await b.post(`${path}/refresh-token`)).status).toBe(401)
      expect(mocks.validateRefresh).not.toHaveBeenCalled()
    },
  )

  it.each(['customer', 'admin'])(
    'invalid %s refresh credentials do not clear the other session',
    async (identity) => {
      const b = browser()
      await customerLogin(b)
      await adminLogin(b)
      mocks.validateRefresh.mockResolvedValueOnce(null)
      const ownPath = identity === 'customer' ? '/auth' : '/admin/auth'
      const otherPath = identity === 'customer' ? '/admin/auth' : '/auth'
      expect((await b.post(`${ownPath}/refresh-token`)).status).toBe(401)
      expect((await b.post(`${otherPath}/refresh-token`)).status).toBe(200)
    },
  )

  it.each(['customer', 'admin'])(
    'rejects the other account type placed in the %s cookie',
    async (identity) => {
      const b = browser()
      await customerLogin(b)
      await adminLogin(b)
      b.cookies.set(
        identity === 'customer' ? 'userRefreshToken' : 'adminRefreshToken',
        b.cookies.get(
          identity === 'customer' ? 'adminRefreshToken' : 'userRefreshToken',
        )!,
      )
      expect(
        (
          await b.post(
            `${identity === 'customer' ? '/auth' : '/admin/auth'}/refresh-token`,
          )
        ).status,
      ).toBe(401)
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.remove).not.toHaveBeenCalled()
    },
  )
})
