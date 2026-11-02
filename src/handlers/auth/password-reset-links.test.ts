import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '@/types'

const config = vi.hoisted(() => ({
  baseUrl: 'https://api.example.test',
  frontEndUrl: 'https://web.example.test',
}))
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  createToken: vi.fn(),
  findToken: vi.fn(),
  transaction: vi.fn(),
  queue: vi.fn(),
  log: vi.fn(),
}))
vi.mock('@/env', () => ({ env: config }))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/logger', () => ({ log: { info: mocks.log, error: mocks.log } }))
vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('new-password-hash'),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: { findUnique: mocks.findUser },
    passwordResetToken: {
      create: mocks.createToken,
      findUnique: mocks.findToken,
    },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/services/email-queue.service', () => ({ queueEmail: mocks.queue }))

import {
  requestPasswordResetHandler,
  resetPasswordWithTokenHandler,
} from './password-reset.handler'

const user = {
  id: 'customer',
  name: 'Customer',
  email: 'user@example.test',
  emailVerified: true,
}
const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('logger', {
    info: mocks.log,
    warn: mocks.log,
    error: mocks.log,
  } as never)
  await next()
})
app.post('/password-reset/request-reset', ...requestPasswordResetHandler)
app.post('/password-reset', ...resetPasswordWithTokenHandler)
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.findUser.mockResolvedValue(user)
  mocks.findToken.mockResolvedValue({
    token: 'reset-token',
    userId: user.id,
    user,
    usedAt: null,
    expiresAt: new Date(Date.now() + 600_000),
  })
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      passwordResetToken: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: { update: vi.fn().mockResolvedValue(user) },
      authToken: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }),
  )
})

it.each(['https://web.example.test', 'https://web.example.test/'])(
  'sends a public reset link to the frontend when FRONT_END_URL=%s',
  async (frontendUrl) => {
    config.frontEndUrl = frontendUrl
    expect(
      (await post('/password-reset/request-reset', { email: user.email }))
        .status,
    ).toBe(200)
    const variables = mocks.queue.mock.calls[0][0].variables
    const token = mocks.createToken.mock.calls[0][0].data.token
    expect(variables.resetLink).toBe(
      `https://web.example.test/reset-password?token=${token}`,
    )
    expect(variables.actionUrl).toBe(variables.resetLink)
    expect(variables.resetLink).not.toContain(config.baseUrl)
  },
)

it.each(['https://web.example.test', 'https://web.example.test/'])(
  'sends the confirmation login link to the frontend when FRONT_END_URL=%s',
  async (frontendUrl) => {
    config.frontEndUrl = frontendUrl
    expect(
      (
        await post('/password-reset', {
          token: 'reset-token',
          newPassword: 'NewPassword123!',
          confirmPassword: 'NewPassword123!',
        })
      ).status,
    ).toBe(200)
    expect(mocks.queue.mock.calls[0][0].variables.actionUrl).toBe(
      'https://web.example.test/?login=true',
    )
  },
)
