import { env } from '@/env'
import dayjs from 'dayjs'
import { sign, verify } from 'hono/jwt'
import { log } from './logger'

export async function generateJwtToken(payloadData: Record<string, any>) {
  try {
    const secret = env.jwt.secret
    const now = dayjs()
    const payload = {
      iss: env.jwt.issuer,
      aud: env.jwt.audience,
      iat: now.unix(),
      exp: now.add(Number(env.jwt.expires), 'minutes').unix(),
      data: payloadData,
    }
    return await sign(payload, secret, 'HS256')
  } catch (err) {
    log.fatal(`Error generating JWT token: ${err}`)
    throw err
  }
}

export async function generateRefreshToken(payloadData: Record<string, any>) {
  try {
    const secret = env.jwt.refreshSecret
    const now = dayjs()
    const payload = {
      iss: env.jwt.issuer,
      aud: env.jwt.audience,
      iat: now.unix(),
      exp: now.add(Number(env.jwt.refreshExpires), 'days').unix(),
      type: 'refresh',
      data: payloadData,
    }
    return await sign(payload, secret, 'HS256')
  } catch (err) {
    log.fatal(`Error generating refresh token: ${err}`)
    throw err
  }
}

export async function validateToken(token: string) {
  try {
    const secret = env.jwt.secret
    const payload = await verify(token, secret, 'HS256')
    if (payload && payload.type === 'refresh') {
      log.error('Invalid JWT token: token is a refresh token')
      return null
    }
    return payload
  } catch (err) {
    log.error(`Invalid JWT token: ${err}`)
    return null
  }
}

export async function validateRefreshToken(token: string) {
  try {
    const secret = env.jwt.refreshSecret
    const payload = await verify(token, secret, 'HS256')
    if (payload && payload.type === 'refresh') {
      return payload
    }
    return null
  } catch (err) {
    log.error(`Invalid refresh token: ${err}`)
    return null
  }
}
