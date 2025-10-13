import pino from 'pino'
import path from 'node:path'
import fs from 'node:fs'

const logDir = path.resolve(__dirname, '../storage/logs')

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

const logFile = path.join(
  logDir,
  `${new Date().toISOString().slice(0, 10)}-log.txt`,
)

const customErrorSerializer = (err: Error) => ({
  type: err.name,
  message: err.message,
  stack: err.stack,
  code: (err as any).code,
  details: (err as any).details,
})

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : {
          target: 'pino/file',
          options: { destination: logFile },
        },
  serializers: {
    err: customErrorSerializer,
  },
})
