import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '@/types'

const controls = vi.hoisted(() => ({ beforeHash: async () => {} }))
vi.mock('@/lib/password', () => ({
  hashPassword: async (password: string) => {
    await controls.beforeHash()
    return `test-hash:${password}`
  },
}))
vi.mock('@/services/email-queue.service', () => ({ queueEmail: vi.fn() }))
import { db } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { resetPasswordWithTokenHandler } from './password-reset.handler'

// DATABASE_URL must point to a disposable PostgreSQL test database.
const run =
  process.env.RUN_EMAIL_RESET_DB_TESTS === '1' ? describe : describe.skip
run('atomic email reset against PostgreSQL', () => {
  const userIds: string[] = []
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('logger', log as never)
    await next()
  })
  app.onError((error, c) =>
    c.json({ success: false }, 'status' in error ? (error.status as 400) : 500),
  )
  app.post('/password-reset', ...resetPasswordWithTokenHandler)
  const post = (token: string, newPassword = 'NewPassword123!') =>
    app.request('/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        newPassword,
        confirmPassword: newPassword,
      }),
    })

  beforeEach(() => {
    controls.beforeHash = async () => {}
  })
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: userIds } } })
    await db.$disconnect()
  })

  async function fixture() {
    const user = await db.user.create({
      data: {
        name: 'Email reset test',
        phone: randomUUID(),
        password: 'old-hash',
      },
    })
    userIds.push(user.id)
    const token = await db.passwordResetToken.create({
      data: {
        userId: user.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 600_000),
      },
    })
    const otherToken = await db.passwordResetToken.create({
      data: {
        userId: user.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 600_000),
      },
    })
    await db.authToken.create({
      data: {
        userId: user.id,
        refreshToken: randomUUID(),
        refreshExpiresAt: new Date(Date.now() + 600_000),
      },
    })
    return { user, token, otherToken }
  }

  it('allows only one of two requests that both passed the initial validity check', async () => {
    const f = await fixture()
    let arrivals = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    controls.beforeHash = async () => {
      if (++arrivals === 2) release()
      await barrier
    }
    const passwords = ['FirstPassword123!', 'SecondPassword123!']
    const responses = await Promise.all(
      passwords.map((password) => post(f.token.token, password)),
    )
    expect(arrivals).toBe(2)
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ])
    const winner = responses.findIndex((response) => response.status === 200)
    expect(
      await db.user.findUnique({ where: { id: f.user.id } }),
    ).toMatchObject({ password: `test-hash:${passwords[winner]}` })
    expect(
      await db.passwordResetToken.count({
        where: { userId: f.user.id, usedAt: null },
      }),
    ).toBe(0)
    expect(await db.authToken.count({ where: { userId: f.user.id } })).toBe(0)
    expect((await post(f.token.token)).status).toBe(400)
  })

  it('rejects a token that expires after preflight and before the transaction', async () => {
    const f = await fixture()
    controls.beforeHash = async () => {
      await db.passwordResetToken.update({
        where: { id: f.token.id },
        data: { expiresAt: new Date(Date.now() - 1) },
      })
    }
    expect((await post(f.token.token)).status).toBe(400)
    expect(
      await db.user.findUnique({ where: { id: f.user.id } }),
    ).toMatchObject({ password: 'old-hash' })
    expect(
      await db.passwordResetToken.findUnique({ where: { id: f.token.id } }),
    ).toMatchObject({ usedAt: null })
    expect(await db.authToken.count({ where: { userId: f.user.id } })).toBe(1)
  })

  it('rolls back token consumption and password changes on a database failure, and permits retry', async () => {
    const f = await fixture()
    // A real database error after token consumption and password update.
    await db.$executeRaw`CREATE FUNCTION test_email_reset_revoke_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test revocation failure'; END $$`
    await db.$executeRaw`CREATE TRIGGER test_email_reset_revoke_failure BEFORE DELETE ON auth_token FOR EACH ROW EXECUTE FUNCTION test_email_reset_revoke_failure()`
    try {
      expect((await post(f.token.token)).status).toBe(500)
      expect(
        await db.user.findUnique({ where: { id: f.user.id } }),
      ).toMatchObject({ password: 'old-hash' })
      expect(
        await db.passwordResetToken.findUnique({ where: { id: f.token.id } }),
      ).toMatchObject({ usedAt: null })
      expect(
        await db.passwordResetToken.findUnique({
          where: { id: f.otherToken.id },
        }),
      ).toMatchObject({ usedAt: null })
      expect(await db.authToken.count({ where: { userId: f.user.id } })).toBe(1)
    } finally {
      await db.$executeRaw`DROP TRIGGER test_email_reset_revoke_failure ON auth_token`
      await db.$executeRaw`DROP FUNCTION test_email_reset_revoke_failure()`
    }
    expect((await post(f.token.token)).status).toBe(200)
    expect(await db.authToken.count({ where: { userId: f.user.id } })).toBe(0)
  })
})
