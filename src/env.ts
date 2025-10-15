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
  logLevel: process.env.LOG_LEVEL ?? 'info',
  dbUrl: req('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL,
  jwt: {
    secret: req('JWT_SECRET'),
    issuer: req('JWT_ISSUER', 'quantum-sport-backend'),
    audience: req('JWT_AUDIENCE', 'quantum-sport-frontend'),
    expires: req('JWT_EXPIRES', '7'),
    refreshExpires: req('JWT_REFRESH_EXPIRES', '30'),
  },
  xendit: {
    apiKey: process.env.XENDIT_API_KEY ?? '',
    callbackToken: process.env.XENDIT_CALLBACK_TOKEN ?? '',
  },
  webhookBaseUrl: req('WEBHOOK_BASE_URL', 'http://localhost:8787/webhooks'),
  ngrokToken: process.env.NGROK_AUTHTOKEN ?? '',
  fazpassGatewayKey: process.env.FAZPASS_GATEWAY_KEY ?? '',
  fazpassMerchantKey: process.env.FAZPASS_MERCHANT_KEY ?? '',
  fazpassApiUrl: process.env.FAZPASS_API_URL ?? 'https://api.fazpass.com/v1',
  PWD_PEPPER: process.env.PWD_PEPPER ?? undefined,
}
