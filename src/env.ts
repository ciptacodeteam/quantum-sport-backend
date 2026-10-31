import 'dotenv/config'

function req(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`Missing env ${name}`)
  return v
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  frontEndUrl: req('FRONT_END_URL', 'http://localhost:3000'),
  baseUrl: req('BASE_URL', `http://localhost:3000`),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  dbUrl: req('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL,
  jwt: {
    secret: req('JWT_SECRET'),
    refreshSecret: req('JWT_REFRESH_SECRET'),
    issuer: req('JWT_ISSUER', 'quantum-sport-backend'),
    audience: req('JWT_AUDIENCE', 'quantum-sport-frontend'),
    expires: req('JWT_EXPIRES', '1'), // in minutes
    refreshExpires: req('JWT_REFRESH_EXPIRES', '30'), // in days
  },
  xendit: {
    apiKey: process.env.XENDIT_API_KEY ?? '',
    callbackToken: process.env.XENDIT_CALLBACK_TOKEN ?? '',
  },
  midtrans: {
    merchantId: process.env.MIDTRANS_MERCHANT_ID ?? '',
    serverKey: process.env.MIDTRANS_SERVER_KEY ?? '',
    clientKey: process.env.MIDTRANS_CLIENT_KEY ?? '',
    /** `snap` for Midtrans Snap popup; `core` for Core API /v2/charge. */
    checkoutMode: (process.env.MIDTRANS_CHECKOUT_MODE === 'core'
      ? 'core'
      : 'snap') as 'snap' | 'core',
  },
  webhookBaseUrl: req('WEBHOOK_BASE_URL', 'http://localhost:8787/webhooks'),
  ngrokToken: process.env.NGROK_AUTHTOKEN ?? '',
  fazpassGatewayKey: process.env.FAZPASS_GATEWAY_KEY ?? '',
  fazpassMerchantKey: process.env.FAZPASS_MERCHANT_KEY ?? '',
  fazpassApiUrl: process.env.FAZPASS_API_URL ?? 'https://api.fazpass.com/v1',
  pwdPepper: process.env.PWD_PEPPER ?? undefined,
  blobToken: process.env.BLOB_READ_WRITE_TOKEN ?? undefined,
  smtp: {
    host: process.env.SMTP_HOST ?? 'smtp.mailtrap.io',
    port: parseInt(process.env.SMTP_PORT ?? '2525'),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'noreply@quantumsport.com',
  },
  storageStrategy: process.env.STORAGE_STRATEGY || 'local', // 'local' or 'blob'
}

const DEPLOYED_NODE_ENVS = new Set(['production', 'staging'])

/** Live droplet runtimes. Development keeps local OTP codes and insecure cookies. */
export function isDeployedEnv(nodeEnv = env.nodeEnv) {
  return DEPLOYED_NODE_ENVS.has(nodeEnv)
}
