import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '@/types'
import { BadRequestException } from '@/exceptions'

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  reset: vi.fn(),
  log: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({ db: {} }))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@/services/email.service', () => ({
  queueSendTemplatedEmail: vi.fn(),
}))
vi.mock('@/services/upload.service', () => ({ getFileUrl: vi.fn() }))
vi.mock('@/services/password-reset-otp.service', () => ({
  verifyPasswordResetOtp: mocks.verify,
  resetPasswordWithOtpToken: mocks.reset,
}))

import {
  resetPasswordHandler,
  verifyResetPasswordOtpHandler,
} from './auth.handler'

const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('logger', { fatal: mocks.log } as never)
  await next()
})
app.post('/auth/reset-password', ...resetPasswordHandler)
app.post('/auth/verify-reset-otp', ...verifyResetPasswordOtpHandler)
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
beforeEach(() => vi.resetAllMocks())

it('rejects the former public requestId-only reset at the HTTP boundary', async () => {
  const response = await post('/auth/reset-password', {
    phone: '081234567890',
    requestId: 'public-request',
    newPassword: 'Password123!',
  })
  expect(response.status).toBe(422)
  expect(mocks.reset).not.toHaveBeenCalled()
})

it('requires an OTP code before issuing reset authorization', async () => {
  const response = await post('/auth/verify-reset-otp', {
    phone: '081234567890',
    requestId: 'public-request',
  })
  expect(response.status).toBe(422)
  expect(mocks.verify).not.toHaveBeenCalled()
})

it('returns the capability from reset-specific OTP verification without caching it', async () => {
  mocks.verify.mockResolvedValue({ resetToken: 'a'.repeat(64) })
  const response = await post('/auth/verify-reset-otp', {
    phone: '081234567890',
    requestId: 'request',
    code: '1234',
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const body = (await response.json()) as { data: { resetToken: string } }
  expect(body.data.resetToken).toBe('a'.repeat(64))
  expect(mocks.verify).toHaveBeenCalledWith('+6281234567890', 'request', '1234')
})

it('does not reset the password when capability validation fails', async () => {
  mocks.reset.mockRejectedValue(
    new BadRequestException('Invalid reset session'),
  )
  const response = await post('/auth/reset-password', {
    phone: '081234567890',
    requestId: 'request',
    resetToken: 'a'.repeat(64),
    newPassword: 'Password123!',
  })
  expect(response.status).toBe(400)
})

it('passes the capability to the reset service and never logs the password', async () => {
  mocks.reset.mockResolvedValue(undefined)
  const response = await post('/auth/reset-password', {
    phone: '081234567890',
    requestId: 'request',
    resetToken: 'a'.repeat(64),
    newPassword: 'Password123!',
  })
  expect(response.status).toBe(200)
  expect(mocks.reset).toHaveBeenCalledWith(
    '+6281234567890',
    'request',
    'a'.repeat(64),
    'Password123!',
  )
  expect(mocks.log).not.toHaveBeenCalled()
})
