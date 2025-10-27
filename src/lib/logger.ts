import { env } from '@/env'
import { pinoLogger } from 'hono-pino'
import pino from 'pino'
import pretty from 'pino-pretty'

// In serverless environments (Vercel), we use stdout
// In local development, we can optionally write to files
const isVercel = process.env.VERCEL === '1'
const isProduction = env.nodeEnv === 'production'

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
      },
    }
  }

  // Local development with pretty console output
  return pretty({
    ignore: 'req.headers.cookie',
    colorize: true,
    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
    levelFirst: true,
  })
}

export const logger = () =>
  pinoLogger({
    pino: pino(getPinoConfig()),
  })

export const log = pino(getPinoConfig())
