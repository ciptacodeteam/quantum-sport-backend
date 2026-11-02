import { env, isDeployedEnv } from '@/env'
import { pinoLogger } from 'hono-pino'
import pino, { type DestinationStream } from 'pino'
import pretty from 'pino-pretty'

// In serverless environments (Vercel), we use stdout
// In local development, we can optionally write to files
const isVercel = process.env.VERCEL === '1'
const isProduction = isDeployedEnv()

const SENSITIVE_KEY =
  /^(password|generatedPassword|currentPassword|newPassword|confirmPassword|code|otp|resetToken|token|refreshToken|userRefreshToken|adminRefreshToken|accessToken|authorization|cookie|x-callback-token|card_number|cvv|secret)$/i

function redactSensitive(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 6) return '[TRUNCATED]'
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = SENSITIVE_KEY.test(key)
        ? '[REDACTED]'
        : redactSensitive(nested, depth + 1)
    }
    return out
  }
  return value
}

// Redact before serialization so raw fields cannot bypass the pretty message
// formatter or be emitted alongside its sanitized message.
export function createLogger(destination?: DestinationStream) {
  const options: pino.LoggerOptions = {
    level: env.logLevel || 'info',
    formatters: {
      log: (object) => redactSensitive(object) as Record<string, unknown>,
    },
  }

  if (destination) return pino(options, destination)
  if (isVercel || (isProduction && process.env.AWS_LAMBDA_FUNCTION_NAME))
    return pino(options)

  return pino(
    options,
    pretty({
      ignore: 'req.headers,res.headers',
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      levelFirst: true,
    }),
  )
}

export const logger = () => pinoLogger({ pino: createLogger() })

export const log = createLogger()
