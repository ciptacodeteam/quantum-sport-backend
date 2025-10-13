import 'dotenv/config'

function req(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`Missing env ${name}`)
  return v
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  baseUrl: req('BASE_URL', `http://localhost:3000`),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  dbUrl: req('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL,
  betterAuthSecret: req('BETTER_AUTH_SECRET'),
  jwt: {
    issuer: req('JWT_ISSUER', 'booking-api'),
    audience: req('JWT_AUDIENCE', 'booking-client'),
    expires: req('JWT_EXPIRES', '7d'),
  },
  xendit: {
    apiKey: process.env.XENDIT_API_KEY ?? '',
    callbackToken: process.env.XENDIT_CALLBACK_TOKEN ?? '',
  },
  webhookBaseUrl: req('WEBHOOK_BASE_URL', 'http://localhost:8787/webhooks'),
  ngrokToken: process.env.NGROK_AUTHTOKEN ?? '',
}
