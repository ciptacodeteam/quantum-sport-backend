import { env } from '@/env'
import dayjs from 'dayjs'
import { log } from './logger'
import { sign, verify } from 'hono/jwt'

export async function generateJwtToken(payloadData: Record<string, any>) {
  try {
    const secret = env.jwt.secret
    const now = dayjs()
    const payload = {
      iss: env.jwt.issuer,
      aud: env.jwt.audience,
      iat: now.unix(),
      exp: now.add(Number(env.jwt.expires), 'days').unix(),
      data: payloadData,
    }
    const token = await sign(payload, secret)
    console.log(token)
    return token
  } catch (err) {
    log.fatal(`Error generating JWT token: ${err}`)
    throw err
  }
}

export async function generateRefreshToken(payloadData: Record<string, any>) {
  try {
    const secret = env.jwt.secret
    const now = dayjs()
    const payload = {
      iss: env.jwt.issuer,
      aud: env.jwt.audience,
      iat: now.unix(),
      exp: now.add(Number(env.jwt.refreshExpires), 'days').unix(),
      type: 'refresh',
      data: payloadData,
    }
    const token = await sign(payload, secret)
    return token
  } catch (err) {
    log.fatal(`Error generating refresh token: ${err}`)
    throw err
  }
}

export async function validateToken(token: string) {
  try {
    const secret = env.jwt.secret
    const payload = await verify(token, secret)
    console.log('🚀 ~ validateToken ~ payload:', payload)
    return payload
  } catch (err) {
    log.error(`Invalid JWT token: ${err}`)
    return null
  }
}

export async function validateRefreshToken(token: string) {
  try {
    const secret = env.jwt.secret
    const payload = await verify(token, secret)
    if (payload && payload.type === 'refresh') {
      return payload
    }
    return null
  } catch (err) {
    log.error(`Invalid refresh token: ${err}`)
    return null
  }
}
