import { env } from '@/env'
import { pinoLogger } from 'hono-pino'
import fs from 'node:fs'
import path from 'node:path'
import pino from 'pino'
import pretty from 'pino-pretty'

const logDir = path.resolve(__dirname, '../storage/logs')

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

const logFile = path.join(
  logDir,
  `${new Date().toISOString().slice(0, 10)}-log.txt`,
)

export const logger = () =>
  pinoLogger({
    pino: pino(
      env.nodeEnv === 'production'
        ? {
            level: env.logLevel || 'info',
            transport: {
              target: 'pino/file',
              options: { destination: logFile },
            },
            formatters: {
              level(label) {
                return { level: label }
              },
            },
          }
        : pretty({
            ignore: 'req.headers.cookie',
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
            levelFirst: true,
          }),
    ),
  })

export const log = pino(
  env.nodeEnv === 'production'
    ? {
        level: env.logLevel || 'info',
        transport: {
          target: 'pino/file',
          options: { destination: logFile },
        },
        formatters: {
          level(label) {
            return { level: label }
          },
        },
      }
    : pretty({
        ignore: 'req.headers.cookie',
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        levelFirst: true,
      }),
)
