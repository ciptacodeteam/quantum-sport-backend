import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import pretty from 'pino-pretty'
import { createLogger } from './logger'

describe('sensitive log data', () => {
  it.each(['json', 'pretty'])(
    'redacts passwords and reset tokens before emitting %s logs',
    async (format) => {
      let output = ''
      const destination = new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString()
          callback()
        },
      })
      const stream =
        format === 'pretty'
          ? pretty({ sync: true, colorize: false, destination })
          : destination
      const logger = createLogger(stream)
      logger.info(
        {
          req: {
            body: {
              phone: '+6281234567890',
              newPassword: 'new-password-secret',
              confirmPassword: 'confirm-password-secret',
              currentPassword: 'current-password-secret',
              generatedPassword: 'generated-password-secret',
              password: 'password-secret',
              resetToken: 'reset-token-secret',
              userRefreshToken: 'user-refresh-secret',
              adminRefreshToken: 'admin-refresh-secret',
            },
          },
          res: { body: { data: { resetToken: 'response-token-secret' } } },
        },
        'Password reset processed',
      )

      await vi.waitFor(() =>
        expect(output).toContain('Password reset processed'),
      )
      expect(output).toContain('[REDACTED]')
      for (const secret of [
        'new-password-secret',
        'confirm-password-secret',
        'current-password-secret',
        'generated-password-secret',
        'password-secret',
        'reset-token-secret',
        'user-refresh-secret',
        'admin-refresh-secret',
        'response-token-secret',
      ])
        expect(output).not.toContain(secret)
    },
  )

  it('does not expose sensitive data beyond the recursion limit', () => {
    let output = ''
    const logger = createLogger({
      write: (chunk) => {
        output += chunk
      },
    })
    let payload: unknown = { newPassword: 'deep-password-secret' }
    for (let index = 0; index < 10; index++) payload = { nested: payload }
    logger.info({ payload }, 'Deep payload')
    expect(output).not.toContain('deep-password-secret')
    expect(output).toContain('[TRUNCATED]')
  })
})
