import { env } from '@/env'
import { pinoLogger } from 'hono-pino'
import pino from 'pino'
import pretty from 'pino-pretty'

// In serverless environments (Vercel), we use stdout
// In local development, we can optionally write to files
const isVercel = process.env.VERCEL === '1'
const isProduction = env.nodeEnv === 'production'

const SENSITIVE_KEY =
  /^(password|token|refreshToken|accessToken|authorization|cookie|x-callback-token|card_number|cvv|secret)$/i

function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key)
        ? '[REDACTED]'
        : redactSensitive(nested, depth + 1)
    }
    return out
  }
  return value
}

// Configuration for serverless (stdout) or local development
const getPinoConfig = () => {
  // On Vercel or production, use stdout (structured logging)
  if (isVercel || (isProduction && process.env.AWS_LAMBDA_FUNCTION_NAME)) {
    return {
      level: env.logLevel || 'info',
      formatters: {
        level(label: string) {
          return { level: label }
        },
        bindings(bindings: any) {
          return bindings
        },
        log(object: any) {
          const out: any = {}
          if (object.req && object.req.body !== undefined) {
            out.req = { payload: redactSensitive(object.req.body) }
          }
          if (object.res && object.res.body !== undefined) {
            out.res = { data: redactSensitive(object.res.body) }
          }
          if (object.msg) out.msg = object.msg
          return out
        },
      },
    }
  }

  // Local development with pretty console output
  return pretty({
    ignore: 'req.headers,res.headers',
    colorize: true,
    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
    levelFirst: true,
    messageFormat: (log) => {
      let msg = ''
      if (log.req && typeof log.req === 'object' && 'body' in log.req) {
        msg += `req.payload: ${JSON.stringify(redactSensitive(log.req.body))} `
      }
      if (log.res && typeof log.res === 'object' && 'body' in log.res) {
        msg += `res.data: ${JSON.stringify(redactSensitive(log.res.body))} `
      }
      if (log.msg) msg += log.msg
      return msg.trim()
    },
  })
}

export const logger = () =>
  pinoLogger({
    pino: pino(getPinoConfig()),
  })

export const log = pino(getPinoConfig())
