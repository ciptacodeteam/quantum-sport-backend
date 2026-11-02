import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono, type MiddlewareHandler } from 'hono'
import type { AppEnv } from '@/types'

const mocks = vi.hoisted(() => ({
  userFind: vi.fn(),
  staffFind: vi.fn(),
  tokenFind: vi.fn(),
  transaction: vi.fn(),
  userUpdate: vi.fn(),
  staffUpdate: vi.fn(),
  revoke: vi.fn(),
  consumeReset: vi.fn(),
  validReset: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  notify: vi.fn(),
  log: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: { findUnique: mocks.userFind },
    staff: { findUnique: mocks.staffFind },
    authToken: { findFirst: mocks.tokenFind },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/middlewares/auth', () => ({
  requireAuth: (async (_c, next) => next()) as MiddlewareHandler,
}))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/password', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}))
vi.mock('@/lib/token', () => ({
  validateRefreshToken: vi.fn().mockResolvedValue({ type: 'refresh' }),
  generateJwtToken: vi.fn(),
  generateRefreshToken: vi.fn(),
}))
vi.mock('@/services/email.service', () => ({
  queueSendTemplatedEmail: mocks.notify,
}))
vi.mock('@/services/phone.service', () => ({
  sendPhoneOtp: vi.fn(),
  verifyPhoneOtp: vi.fn(),
}))
vi.mock('@/services/email-queue.service', () => ({ queueEmail: mocks.notify }))
vi.mock('@/services/password-reset.service', () => ({
  getValidPasswordResetToken: mocks.validReset,
}))
vi.mock('@/services/upload.service', () => ({
  getFileUrl: vi.fn(),
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
}))

import { changeUserPasswordHandler, refreshTokenHandler } from './auth.handler'
import {
  changePasswordAdminHandler,
  refreshTokenAdminHandler,
} from './admin/auth.handler'
import { changeStaffPasswordHandler } from './admin/staff.handler'
import { resetPasswordWithTokenHandler } from './auth/password-reset.handler'

const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('user', { id: 'user-1', phone: '+6281234567890' })
  c.set(
    'admin',
    c.req.path.startsWith('/admin')
      ? {
          id: 'staff-1',
          email: 'admin@example.com',
          role: 'ADMIN',
        }
      : null,
  )
  c.set('logger', {
    info: mocks.log,
    warn: mocks.log,
    error: mocks.log,
    fatal: mocks.log,
  } as never)
  await next()
})
app.onError((error, c) =>
  c.json(
    { error: error.message },
    'status' in error ? (error.status as 400) : 500,
  ),
)
app.post('/auth/change-password', ...changeUserPasswordHandler)
app.post('/admin/auth/change-password', ...changePasswordAdminHandler)
app.post('/admin/staffs/:id/reset-password', ...changeStaffPasswordHandler)
app.post('/password-reset', ...resetPasswordWithTokenHandler)
app.post('/auth/refresh-token', ...refreshTokenHandler)
app.post('/admin/auth/refresh-token', ...refreshTokenAdminHandler)

type Session = { refreshToken: string; userId?: string; staffId?: string }
let sessions: Session[]
let userPassword: string
let staffPassword: string
let resetUsed: boolean
const user = () => ({
  id: 'user-1',
  name: 'Customer',
  email: 'user@example.com',
  password: userPassword,
})
const staff = () => ({
  id: 'staff-1',
  name: 'Admin',
  email: 'admin@example.com',
  password: staffPassword,
})
const changePayload = {
  currentPassword: 'OldPassword1!',
  newPassword: 'NewPassword1!',
  confirmNewPassword: 'NewPassword1!',
}
const emailPayload = {
  token: 'email-reset-token',
  newPassword: 'NewPassword1!',
  confirmPassword: 'NewPassword1!',
}
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  sessions = [
    { refreshToken: 'customer-device-1', userId: 'user-1' },
    { refreshToken: 'customer-device-2', userId: 'user-1' },
    { refreshToken: 'another-customer', userId: 'user-2' },
    { refreshToken: 'admin-device-1', staffId: 'staff-1' },
    { refreshToken: 'admin-device-2', staffId: 'staff-1' },
    { refreshToken: 'another-admin', staffId: 'staff-2' },
  ]
  userPassword = 'old-user-hash'
  staffPassword = 'old-staff-hash'
  resetUsed = false
  mocks.userFind.mockImplementation(async () => user())
  mocks.staffFind.mockImplementation(async () => staff())
  mocks.tokenFind.mockImplementation(
    async ({ where }) =>
      sessions.find((session) => session.refreshToken === where.refreshToken) ??
      null,
  )
  mocks.verifyPassword.mockResolvedValue(true)
  mocks.hashPassword.mockResolvedValue('new-password-hash')
  mocks.notify.mockResolvedValue(undefined)
  mocks.validReset.mockImplementation(async () =>
    resetUsed ? null : { user: user(), userId: 'user-1' },
  )
  mocks.userUpdate.mockImplementation(async ({ data }) => {
    userPassword = data.password
    return user()
  })
  mocks.staffUpdate.mockImplementation(async ({ data }) => {
    staffPassword = data.password
    return staff()
  })
  mocks.revoke.mockImplementation(async ({ where }) => {
    sessions = sessions.filter(
      (session) =>
        !Object.entries(where).every(
          ([key, value]) => session[key as keyof Session] === value,
        ),
    )
    return { count: 2 }
  })
  mocks.consumeReset.mockImplementation(async ({ where }) => {
    if (where.token && resetUsed) return { count: 0 }
    resetUsed = true
    return { count: 1 }
  })
  mocks.transaction.mockImplementation(async (callback) => {
    const previous = {
      sessions: [...sessions],
      userPassword,
      staffPassword,
      resetUsed,
    }
    try {
      return await callback({
        user: { update: mocks.userUpdate },
        staff: { update: mocks.staffUpdate },
        authToken: { deleteMany: mocks.revoke },
        passwordResetToken: { updateMany: mocks.consumeReset },
      })
    } catch (error) {
      sessions = previous.sessions
      userPassword = previous.userPassword
      staffPassword = previous.staffPassword
      resetUsed = previous.resetUsed
      throw error
    }
  })
})

const flows = [
  {
    name: 'email reset',
    path: '/password-reset',
    payload: emailPayload,
    owner: 'userId',
    refreshPath: '/auth/refresh-token',
    oldToken: 'customer-device-1',
  },
  {
    name: 'customer password change',
    path: '/auth/change-password',
    payload: changePayload,
    owner: 'userId',
    refreshPath: '/auth/refresh-token',
    oldToken: 'customer-device-1',
  },
  {
    name: 'admin password change',
    path: '/admin/auth/change-password',
    payload: changePayload,
    owner: 'staffId',
    refreshPath: '/admin/auth/refresh-token',
    oldToken: 'admin-device-1',
  },
  {
    name: 'staff reset by admin',
    path: '/admin/staffs/staff-1/reset-password',
    payload: {},
    owner: 'staffId',
    refreshPath: '/admin/auth/refresh-token',
    oldToken: 'admin-device-1',
  },
] as const

describe.each(flows)('$name', (flow) => {
  it('revokes every refresh session of the affected account and preserves other accounts', async () => {
    expect((await post(flow.path, flow.payload)).status).toBe(200)
    const id = flow.owner === 'userId' ? 'user-1' : 'staff-1'
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { [flow.owner]: id } })
    expect(
      sessions.filter((session) => session[flow.owner] === id),
    ).toHaveLength(0)
    expect(sessions).toHaveLength(4)
    expect(flow.owner === 'userId' ? userPassword : staffPassword).toBe(
      'new-password-hash',
    )
    const response = await app.request(flow.refreshPath, {
      method: 'POST',
      headers: {
        Cookie: `${flow.owner === 'userId' ? 'userRefreshToken' : 'adminRefreshToken'}=${flow.oldToken}`,
      },
    })
    expect(response.status).toBe(401)
  })

  it('rolls back the password and token consumption if revocation fails', async () => {
    mocks.revoke.mockRejectedValueOnce(new Error('Session store unavailable'))
    expect((await post(flow.path, flow.payload)).status).toBe(500)
    expect(userPassword).toBe('old-user-hash')
    expect(staffPassword).toBe('old-staff-hash')
    expect(sessions).toHaveLength(6)
    expect(resetUsed).toBe(false)
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})

it.each(['/auth/change-password', '/admin/auth/change-password'])(
  'does not revoke sessions for a wrong current password at %s',
  async (path) => {
    mocks.verifyPassword.mockResolvedValueOnce(false)
    expect((await post(path, changePayload)).status).toBeGreaterThanOrEqual(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.revoke).not.toHaveBeenCalled()
  },
)

it('rejects an invalid email reset link without revoking sessions', async () => {
  mocks.validReset.mockResolvedValueOnce(null)
  expect((await post('/password-reset', emailPayload)).status).toBe(400)
  expect(mocks.transaction).not.toHaveBeenCalled()
})

it('rejects a reset link that was consumed after validation', async () => {
  mocks.consumeReset.mockResolvedValueOnce({ count: 0 })
  expect((await post('/password-reset', emailPayload)).status).toBe(400)
  expect(mocks.userUpdate).not.toHaveBeenCalled()
  expect(mocks.revoke).not.toHaveBeenCalled()
})

it('does not change the password or sessions if consuming the email reset token fails', async () => {
  mocks.consumeReset.mockRejectedValueOnce(
    new Error('Token storage unavailable'),
  )
  expect((await post('/password-reset', emailPayload)).status).toBe(500)
  expect(mocks.userUpdate).not.toHaveBeenCalled()
  expect(mocks.revoke).not.toHaveBeenCalled()
  expect(userPassword).toBe('old-user-hash')
  expect(sessions).toHaveLength(6)
})

it('rolls back the password and sessions if invalidating other reset links fails', async () => {
  mocks.consumeReset
    .mockResolvedValueOnce({ count: 1 })
    .mockRejectedValueOnce(new Error('Token invalidation failed'))
  expect((await post('/password-reset', emailPayload)).status).toBe(500)
  expect(userPassword).toBe('old-user-hash')
  expect(sessions).toHaveLength(6)
  expect(resetUsed).toBe(false)
  expect(mocks.notify).not.toHaveBeenCalled()
})

it('generates a distinct strong temporary password for every staff reset and requires rotation', async () => {
  const first = await post('/admin/staffs/staff-1/reset-password', {})
  const second = await post('/admin/staffs/staff-1/reset-password', {})
  const a = (await first.json()) as { data: { generatedPassword: string } }
  const b = (await second.json()) as { data: { generatedPassword: string } }
  expect(a.data.generatedPassword).toMatch(/^[A-Za-z0-9_-]{32}$/)
  expect(b.data.generatedPassword).not.toBe(a.data.generatedPassword)
  expect(mocks.hashPassword).toHaveBeenCalledWith(a.data.generatedPassword)
  expect(mocks.hashPassword).toHaveBeenCalledWith(b.data.generatedPassword)
  expect(mocks.staffUpdate).toHaveBeenCalledWith({
    where: { id: 'staff-1' },
    data: { password: 'new-password-hash', mustChangePassword: true },
  })
  expect(first.headers.get('Cache-Control')).toBe('no-store')
})

it('clears the rotation requirement only after the staff member changes their password', async () => {
  mocks.staffFind.mockResolvedValueOnce({
    ...staff(),
    mustChangePassword: true,
  })
  expect(
    (await post('/admin/auth/change-password', changePayload)).status,
  ).toBe(200)
  expect(mocks.staffUpdate).toHaveBeenCalledWith({
    where: { id: 'staff-1' },
    data: { password: 'new-password-hash', mustChangePassword: false },
  })
})

it('rejects a short replacement password while rotation is required', async () => {
  mocks.staffFind.mockResolvedValueOnce({
    ...staff(),
    mustChangePassword: true,
  })
  expect(
    (
      await post('/admin/auth/change-password', {
        ...changePayload,
        newPassword: 'short123',
        confirmNewPassword: 'short123',
      })
    ).status,
  ).toBe(400)
  expect(mocks.transaction).not.toHaveBeenCalled()
})
