import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  userUpdate: vi.fn(),
  revoke: vi.fn(),
  transaction: vi.fn(),
  verify: vi.fn(),
  hash: vi.fn(),
}))
vi.mock('@/env', () => ({ isDeployedEnv: () => true }))
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn() } }))
vi.mock('@/lib/password', () => ({ hashPassword: mocks.hash }))
vi.mock('@/services/phone.service', () => ({ verifyPhoneOtp: mocks.verify }))
vi.mock('@/lib/prisma', () => ({
  db: {
    phoneVerification: {
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
    $transaction: mocks.transaction,
  },
}))

import {
  verifyPasswordResetOtp,
  resetPasswordWithOtpToken,
} from './password-reset-otp.service'
import { resetPasswordSchema } from '@/lib/validation'

const phone = '+6281234567890'
const requestId = 'provider-request'
const token = 'a'.repeat(64)
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
let row: Record<string, any> | null
let password: string
let queue: Promise<unknown>
const matches = (where: Record<string, any>) =>
  row &&
  Object.entries(where).every(([key, value]) =>
    key === 'expiresAt'
      ? row!.expiresAt > value.gt
      : key === 'attempts'
        ? row!.attempts < value.lt
        : row![key] === value,
  )

beforeEach(() => {
  vi.resetAllMocks()
  row = {
    id: 'otp-row',
    attempts: 0,
    phone,
    requestId,
    code: 'MASKED',
    type: 'FORGOT_PASSWORD',
    isUsed: false,
    expiresAt: new Date(Date.now() + 600_000),
  }
  password = 'old-hash'
  queue = Promise.resolve()
  mocks.findFirst.mockImplementation(async ({ where }) =>
    matches(where) ? { ...row } : null,
  )
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    if (!matches(where)) return { count: 0 }
    row = {
      ...row,
      ...data,
      ...(data.attempts?.increment
        ? { attempts: row!.attempts + data.attempts.increment }
        : {}),
    }
    return { count: 1 }
  })
  mocks.deleteMany.mockImplementation(async ({ where }) => {
    if (!matches(where)) return { count: 0 }
    row = null
    return { count: 1 }
  })
  mocks.userUpdate.mockImplementation(async ({ data }) => {
    password = data.password
    return { id: 'user-1' }
  })
  mocks.revoke.mockResolvedValue({ count: 2 })
  mocks.verify.mockResolvedValue({ success: true })
  mocks.hash.mockResolvedValue('new-hash')
  // Model transactional commit/rollback and row contention without a live DB.
  mocks.transaction.mockImplementation((callback) => {
    const result = queue.then(async () => {
      const previousRow = row && { ...row }
      const previousPassword = password
      try {
        return await callback({
          phoneVerification: { deleteMany: mocks.deleteMany },
          user: { update: mocks.userUpdate },
          authToken: { deleteMany: mocks.revoke },
        })
      } catch (error) {
        row = previousRow
        password = previousPassword
        throw error
      }
    })
    queue = result.catch(() => {})
    return result
  })
})

describe('password reset authorization', () => {
  it('rejects the legacy requestId-only payload', () => {
    expect(
      resetPasswordSchema.safeParse({
        phone,
        requestId,
        newPassword: 'Password123!',
      }).success,
    ).toBe(false)
  })

  it.each(['wrong-phone', 'wrong-request', 'wrong-purpose', 'used', 'expired'])(
    'rejects %s before contacting the provider',
    async (kind) => {
      if (kind === 'wrong-phone') row!.phone = '+6289999999999'
      if (kind === 'wrong-request') row!.requestId = 'another-request'
      if (kind === 'wrong-purpose') row!.type = 'VERIFY_PHONE'
      if (kind === 'used') row!.isUsed = true
      if (kind === 'expired') row!.expiresAt = new Date(Date.now() - 1)
      await expect(
        verifyPasswordResetOtp(phone, requestId, '1234'),
      ).rejects.toThrow()
      expect(mocks.verify).not.toHaveBeenCalled()
      expect(mocks.userUpdate).not.toHaveBeenCalled()
    },
  )

  it('rejects an incorrect OTP without issuing a reset capability', async () => {
    mocks.verify.mockResolvedValue({
      success: false,
      message: 'Kode OTP salah',
    })
    await expect(
      verifyPasswordResetOtp(phone, requestId, '9999'),
    ).rejects.toThrow('Kode OTP salah')
    expect(row!.isUsed).toBe(false)
    expect(row!.attempts).toBe(1)
  })

  it('fails closed when the OTP provider is unavailable', async () => {
    mocks.verify.mockRejectedValue(new Error('Provider unavailable'))
    await expect(
      verifyPasswordResetOtp(phone, requestId, '1234'),
    ).rejects.toThrow()
    expect(row!.isUsed).toBe(false)
    expect(row!.attempts).toBe(1)
  })

  it('issues a random capability only after provider verification and stores its digest', async () => {
    const result = await verifyPasswordResetOtp(phone, requestId, '1234')
    expect(mocks.verify).toHaveBeenCalledWith(requestId, '1234')
    expect(result.resetToken).toMatch(/^[a-f0-9]{64}$/)
    expect(row!.code).toBe(digest(result.resetToken))
    expect(row!.isUsed).toBe(true)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('allows only one concurrent verification to issue a capability', async () => {
    const results = await Promise.allSettled([
      verifyPasswordResetOtp(phone, requestId, '1234'),
      verifyPasswordResetOtp(phone, requestId, '1234'),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
  })

  it('rejects a reset using only the public requestId', async () => {
    await expect(
      resetPasswordWithOtpToken(phone, requestId, token, 'Password123!'),
    ).rejects.toThrow()
    expect(mocks.hash).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('changes the password, revokes refresh sessions, and rejects replay', async () => {
    const { resetToken } = await verifyPasswordResetOtp(
      phone,
      requestId,
      '1234',
    )
    await resetPasswordWithOtpToken(
      phone,
      requestId,
      resetToken,
      'Password123!',
    )
    expect(password).toBe('new-hash')
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { password: 'new-hash', phoneVerified: true },
      }),
    )
    expect(row).toBeNull()
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    await expect(
      resetPasswordWithOtpToken(phone, requestId, resetToken, 'Another123!'),
    ).rejects.toThrow()
    expect(mocks.userUpdate).toHaveBeenCalledTimes(1)
  })

  it.each(['expired', 'resent', 'wrong-token', 'wrong-phone', 'wrong-purpose'])(
    'rejects a capability that is %s',
    async (kind) => {
      const { resetToken } = await verifyPasswordResetOtp(
        phone,
        requestId,
        '1234',
      )
      if (kind === 'expired') row!.expiresAt = new Date(Date.now() - 1)
      if (kind === 'resent') row!.requestId = 'replacement-request'
      if (kind === 'wrong-phone') row!.phone = '+6289999999999'
      if (kind === 'wrong-purpose') row!.type = 'VERIFY_PHONE'
      await expect(
        resetPasswordWithOtpToken(
          phone,
          requestId,
          kind === 'wrong-token' ? token : resetToken,
          'Password123!',
        ),
      ).rejects.toThrow()
      expect(mocks.userUpdate).not.toHaveBeenCalled()
    },
  )

  it('allows only one concurrent reset to consume the capability', async () => {
    const { resetToken } = await verifyPasswordResetOtp(
      phone,
      requestId,
      '1234',
    )
    const results = await Promise.allSettled([
      resetPasswordWithOtpToken(phone, requestId, resetToken, 'Password123!'),
      resetPasswordWithOtpToken(phone, requestId, resetToken, 'Another123!'),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(mocks.userUpdate).toHaveBeenCalledTimes(1)
  })

  it('rolls back capability consumption if the password update fails', async () => {
    const { resetToken } = await verifyPasswordResetOtp(
      phone,
      requestId,
      '1234',
    )
    mocks.userUpdate.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(
      resetPasswordWithOtpToken(phone, requestId, resetToken, 'Password123!'),
    ).rejects.toThrow()
    expect(row!.code).toBe(digest(resetToken))
    expect(password).toBe('old-hash')
    expect(mocks.revoke).not.toHaveBeenCalled()
    await resetPasswordWithOtpToken(
      phone,
      requestId,
      resetToken,
      'Password123!',
    )
    expect(password).toBe('new-hash')
  })
})
