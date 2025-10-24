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
      exp: now.add(Number(env.jwt.expires), 'minutes').unix(),
      data: payloadData,
    }
    log.debug(`Generating JWT token with payload: ${JSON.stringify(payload)}`)
    const token = await sign(payload, secret)
    log.debug(`Generated JWT token: ${token}`)
    return token
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
    log.debug(
      `Generating refresh token with payload: ${JSON.stringify(payload)}`,
    )
    const token = await sign(payload, secret)
    log.debug(`Generated refresh token: ${token}`)
    return token
  } catch (err) {
    log.fatal(`Error generating refresh token: ${err}`)
    throw err
  }
}

export async function validateToken(token: string) {
  try {
    const secret = env.jwt.secret
    log.debug(`Validating JWT token: ${token}`)
    const payload = await verify(token, secret)
    if (payload && payload.type === 'refresh') {
      log.error(`Invalid JWT token: token is a refresh token`)
      return null
    }
    log.debug(`Validated JWT token with payload: ${JSON.stringify(payload)}`)
    return payload
  } catch (err) {
    log.error(`Invalid JWT token: ${err}`)
    return null
  }
}

export async function validateRefreshToken(token: string) {
  try {
    const secret = env.jwt.refreshSecret
    log.debug(`Validating refresh token: ${token}`)
    const payload = await verify(token, secret)
    log.debug(
      `Validated refresh token with payload: ${JSON.stringify(payload)}`,
    )
    if (payload && payload.type === 'refresh') {
      return payload
    }
    return null
  } catch (err) {
    log.error(`Invalid refresh token: ${err}`)
    return null
  }
}
