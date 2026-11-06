import { Hono } from 'hono'
import type { AppEnv } from '@/types'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  user: null as any,
  row: null as any,
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  userCreate: vi.fn(),
  otpFind: vi.fn(),
  otpUpdate: vi.fn(),
  otpUpsert: vi.fn(),
  otpDelete: vi.fn(),
  authCreate: vi.fn(),
  revoke: vi.fn(),
  verifyPassword: vi.fn(),
  hash: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: any[]) => handlers },
}))
vi.mock('@/env', () => ({
  env: { jwt: { expires: 60, refreshExpires: 7 } },
  isDeployedEnv: () => false,
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: {
      findUnique: mocks.userFind,
      update: mocks.userUpdate,
      create: mocks.userCreate,
    },
    phoneVerification: {
      findFirst: mocks.otpFind,
      updateMany: mocks.otpUpdate,
      upsert: mocks.otpUpsert,
      deleteMany: mocks.otpDelete,
    },
    authToken: { create: mocks.authCreate, deleteMany: mocks.revoke },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/password', () => ({
  verifyPassword: mocks.verifyPassword,
  hashPassword: mocks.hash,
}))
vi.mock('@/lib/token', () => ({
  generateJwtToken: async () => 'access-token',
  generateRefreshToken: async () => 'refresh-token',
  validateRefreshToken: vi.fn(),
}))
vi.mock('@/services/phone.service', () => ({
  sendPhoneOtp: vi.fn(),
  verifyPhoneOtp: vi.fn(),
}))
vi.mock('@/services/email.service', () => ({
  queueSendTemplatedEmail: vi.fn(),
}))
vi.mock('@/services/upload.service', () => ({ getFileUrl: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn() } }))
import { DEFAULT_OTP_CODE } from '@/constants'
import {
  checkAccountHandler,
  loginHandler,
  registerHandler,
  verifyRegistrationOtpHandler,
} from './auth.handler'
import {
  sendPhoneVerificationOtpHandler,
  verifyPhoneVerificationOtpHandler,
} from './phone.handler'
const phone = '+6281234567890'
const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set(
    'logger' as never,
    { fatal: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } as never,
  )
  await next()
})
app.onError((error, c) =>
  c.json(
    { message: error.message },
    'status' in error ? (error as any).status : 500,
  ),
)
app.post('/auth/check-account', ...checkAccountHandler)
app.post('/auth/login', ...loginHandler)
app.post('/auth/register', ...registerHandler)
app.post('/auth/verify-registration-otp', ...verifyRegistrationOtpHandler)
app.post('/phone/send-otp', ...sendPhoneVerificationOtpHandler)
app.post('/phone/verify-otp', ...verifyPhoneVerificationOtpHandler)
const post = (url: string, body: unknown) =>
  app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const registration = {
  phone,
  firstName: 'Andry',
  lastName: 'Wijaya',
  password: 'Password123!',
  requestId: 'otp-request',
  code: DEFAULT_OTP_CODE,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = {
    id: 'existing-walkin',
    name: 'Old name',
    phone,
    password: 'legacy-phone-hash',
    source: 'WALK_IN',
    phoneVerified: false,
    googleId: null,
    banned: false,
  }
  mocks.row = {
    id: 'otp-row',
    phone,
    requestId: 'otp-request',
    type: 'REGISTER',
    code: DEFAULT_OTP_CODE,
    isUsed: false,
    attempts: 0,
    createdAt: new Date(Date.now() - 61000),
    expiresAt: new Date(Date.now() + 600000),
  }
  mocks.userFind.mockImplementation(async () => mocks.user && { ...mocks.user })
  mocks.userUpdate.mockImplementation(
    async ({ data }) => (mocks.user = { ...mocks.user, ...data }),
  )
  mocks.userCreate.mockImplementation(
    async ({ data }) => (mocks.user = { id: 'new-customer', ...data }),
  )
  mocks.otpFind.mockImplementation(async ({ where }) =>
    mocks.row &&
    Object.entries(where).every(([key, value]: any) =>
      key === 'expiresAt'
        ? mocks.row.expiresAt > value.gt
        : mocks.row[key] === value,
    )
      ? { ...mocks.row }
      : null,
  )
  mocks.otpUpdate.mockImplementation(async ({ where, data }) => {
    if (
      !mocks.row ||
      !Object.entries(where).every(([key, value]: any) =>
        key === 'expiresAt'
          ? mocks.row.expiresAt > value.gt
          : key === 'attempts'
            ? mocks.row.attempts < value.lt
            : mocks.row[key] === value,
      )
    )
      return { count: 0 }
    mocks.row = {
      ...mocks.row,
      ...data,
      ...(data.attempts?.increment
        ? { attempts: mocks.row.attempts + data.attempts.increment }
        : {}),
    }
    return { count: 1 }
  })
  mocks.otpDelete.mockImplementation(async ({ where }) => {
    if (
      !mocks.row ||
      !Object.entries(where).every(([key, value]: any) =>
        key === 'expiresAt'
          ? mocks.row.expiresAt > value.gt
          : mocks.row[key] === value,
      )
    )
      return { count: 0 }
    mocks.row = null
    return { count: 1 }
  })
  mocks.otpUpsert.mockImplementation(
    async ({ update }) => (mocks.row = { ...mocks.row, ...update }),
  )
  mocks.hash.mockResolvedValue('new-password-hash')
  mocks.verifyPassword.mockResolvedValue(false)
  mocks.transaction.mockImplementation(async (fn) => {
    const oldUser = mocks.user && { ...mocks.user },
      oldRow = mocks.row && { ...mocks.row }
    try {
      return await fn({
        user: {
          findUnique: mocks.userFind,
          update: mocks.userUpdate,
          create: mocks.userCreate,
        },
        phoneVerification: {
          updateMany: mocks.otpUpdate,
          deleteMany: mocks.otpDelete,
        },
        authToken: { create: mocks.authCreate, deleteMany: mocks.revoke },
        $queryRaw: mocks.lock,
      })
    } catch (error) {
      mocks.user = oldUser
      mocks.row = oldRow
      throw error
    }
  })
})
it('routes a legacy walk-in to activation without checking its generated password', async () => {
  const response = await post('/auth/check-account', { phone: '081234567890' })
  expect(((await response.json()) as any).data).toMatchObject({
    phone,
    exists: false,
    nextAction: 'ACTIVATE',
  })
  expect(mocks.userFind).toHaveBeenCalledWith({ where: { phone } })
  const login = await post('/auth/login', { phone, password: 'wrong-pass' })
  expect(login.status).toBe(409)
  expect(((await login.json()) as any).errors.nextAction).toBe('ACTIVATE')
  expect(mocks.verifyPassword).not.toHaveBeenCalled()
})
it.each([true, false])(
  'keeps established online accounts in login even when phoneVerified=%s',
  async (phoneVerified) => {
    mocks.user = {
      ...mocks.user,
      source: 'ONLINE',
      phoneVerified,
      password: 'customer-password',
    }
    const response = await post('/auth/check-account', { phone })
    expect(((await response.json()) as any).data).toMatchObject({
      exists: true,
      nextAction: 'LOGIN',
    })
    const send = await post('/phone/send-otp', { phone, purpose: 'REGISTER' })
    expect(send.status).toBe(400)
    expect(mocks.otpUpsert).not.toHaveBeenCalled()
  },
)
it('sends registration OTP without changing the walk-in name, password or verification', async () => {
  const response = await post('/phone/send-otp', {
    phone,
    name: 'Attacker name',
    password: 'OtherPassword',
    purpose: 'REGISTER',
  })
  expect(response.status).toBe(200)
  expect(mocks.user.name).toBe('Old name')
  expect(mocks.user.password).toBe('legacy-phone-hash')
  expect(mocks.userUpdate).not.toHaveBeenCalled()
  expect(mocks.userCreate).not.toHaveBeenCalled()
  expect(mocks.otpUpsert.mock.calls[0][0].update).toMatchObject({
    type: 'REGISTER',
    attempts: 0,
    isUsed: false,
  })
})
it('activates the same account only after OTP and preserves its identity and origin', async () => {
  const response = await post('/auth/register', registration)
  expect(response.status).toBe(201)
  expect(mocks.user).toMatchObject({
    id: 'existing-walkin',
    name: 'Andry Wijaya',
    firstName: 'Andry',
    lastName: 'Wijaya',
    source: 'WALK_IN',
    password: 'new-password-hash',
    phoneVerified: true,
  })
  expect(mocks.userCreate).not.toHaveBeenCalled()
  expect(mocks.revoke).toHaveBeenCalledWith({
    where: { userId: 'existing-walkin' },
  })
  expect(mocks.authCreate.mock.calls[0][0].data.userId).toBe('existing-walkin')
  expect(mocks.row.isUsed).toBe(true)
  expect((await post('/auth/register', registration)).status).toBe(400)
})
it('creates a new customer only after verified OTP and supports single-word names', async () => {
  mocks.user = null
  expect(
    (await post('/phone/send-otp', { phone, purpose: 'REGISTER' })).status,
  ).toBe(200)
  expect(mocks.userCreate).not.toHaveBeenCalled()
  mocks.row.requestId = 'otp-request'
  expect(
    (await post('/auth/register', { ...registration, lastName: '' })).status,
  ).toBe(201)
  expect(mocks.user).toMatchObject({
    name: 'Andry',
    firstName: 'Andry',
    lastName: '',
    source: 'ONLINE',
    phoneVerified: true,
  })
})
it.each(['wrong', 'expired', 'used', 'reset-purpose', 'five-attempts'])(
  'rejects %s OTP without changing the customer',
  async (kind) => {
    let code = registration.code
    if (kind === 'wrong') code = code === '9999' ? '8888' : '9999'
    if (kind === 'expired') mocks.row.expiresAt = new Date(Date.now() - 1)
    if (kind === 'used') mocks.row.isUsed = true
    if (kind === 'reset-purpose') mocks.row.type = 'FORGOT_PASSWORD'
    if (kind === 'five-attempts') mocks.row.attempts = 5
    expect(
      (await post('/auth/register', { ...registration, code })).status,
    ).toBe(400)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
    expect(mocks.authCreate).not.toHaveBeenCalled()
  },
)
it('rejects a resend that replaces the OTP after validation and before commit', async () => {
  mocks.hash.mockImplementation(async () => {
    mocks.row.requestId = 'resent-request'
    return 'hash'
  })
  expect((await post('/auth/register', registration)).status).toBe(400)
  expect(mocks.userUpdate).not.toHaveBeenCalled()
})
it('rolls back OTP consumption if updating the customer fails', async () => {
  mocks.userUpdate.mockRejectedValueOnce(new Error('temporary database error'))
  expect((await post('/auth/register', registration)).status).toBe(500)
  expect(mocks.row.isUsed).toBe(false)
  expect(mocks.user.phoneVerified).toBe(false)
})
it('enforces a one-minute resend delay without changing customer data', async () => {
  mocks.row.createdAt = new Date()
  expect(
    (await post('/phone/send-otp', { phone, purpose: 'REGISTER' })).status,
  ).toBe(429)
  expect(mocks.otpUpsert).not.toHaveBeenCalled()
  expect(mocks.userUpdate).not.toHaveBeenCalled()
})
it('does not reactivate an account that became verified while the OTP was being checked', async () => {
  mocks.hash.mockImplementation(async () => {
    mocks.user.phoneVerified = true
    return 'hash'
  })
  expect((await post('/auth/register', registration)).status).toBe(400)
  expect(mocks.userUpdate).not.toHaveBeenCalled()
})

it('keeps registration OTP isolated from the generic phone verification endpoint', async () => {
  expect(
    (
      await post('/phone/verify-otp', {
        phone,
        requestId: 'otp-request',
        code: DEFAULT_OTP_CODE,
      })
    ).status,
  ).toBe(400)
  expect(mocks.row.isUsed).toBe(false)
  expect((await post('/auth/register', registration)).status).toBe(201)
})
it('locks the same request after five failed OTP guesses', async () => {
  const wrong = String(DEFAULT_OTP_CODE) === '9999' ? '8888' : '9999'
  for (let i = 0; i < 5; i++)
    expect(
      (await post('/auth/register', { ...registration, code: wrong })).status,
    ).toBe(400)
  expect(mocks.row.attempts).toBe(5)
  expect((await post('/auth/register', registration)).status).toBe(400)
  expect(mocks.userUpdate).not.toHaveBeenCalled()
})
it('does not activate a currently banned customer', async () => {
  mocks.user.banned = true
  expect((await post('/auth/register', registration)).status).toBe(403)
  expect(mocks.userUpdate).not.toHaveBeenCalled()
  expect(mocks.authCreate).not.toHaveBeenCalled()
})

it('verifies OTP before allowing password creation, binds the grant to its phone and consumes it once', async () => {
  const verification = await post('/auth/verify-registration-otp', {
    phone,
    requestId: 'otp-request',
    code: DEFAULT_OTP_CODE,
  })
  expect(verification.status).toBe(200)
  const { registrationToken } = ((await verification.json()) as any).data
  expect(registrationToken).toMatch(/^[a-f0-9]{64}$/)
  expect(mocks.row.code).not.toBe(registrationToken)
  expect(mocks.userUpdate).not.toHaveBeenCalled()
  const withoutCode = { ...registration, code: undefined }
  expect(
    (
      await post('/auth/register', {
        ...withoutCode,
        phone: '+6289999999999',
        registrationToken,
      })
    ).status,
  ).toBe(400)
  const result = await post('/auth/register', {
    ...withoutCode,
    registrationToken,
  })
  expect(result.status).toBe(201)
  expect(mocks.user).toMatchObject({
    id: 'existing-walkin',
    phoneVerified: true,
    password: 'new-password-hash',
  })
  expect(mocks.row).toBeNull()
  expect(
    (await post('/auth/register', { ...withoutCode, registrationToken }))
      .status,
  ).toBe(400)
})
it('rejects an expired or replaced registration grant before hashing a password', async () => {
  const verification = await post('/auth/verify-registration-otp', {
    phone,
    requestId: 'otp-request',
    code: DEFAULT_OTP_CODE,
  })
  const { registrationToken } = ((await verification.json()) as any).data
  mocks.row.expiresAt = new Date(Date.now() - 1)
  const withoutCode = { ...registration, code: undefined }
  expect(
    (await post('/auth/register', { ...withoutCode, registrationToken }))
      .status,
  ).toBe(400)
  expect(mocks.hash).not.toHaveBeenCalled()
  expect(mocks.userUpdate).not.toHaveBeenCalled()
})
