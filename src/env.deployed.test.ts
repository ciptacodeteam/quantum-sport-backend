import { describe, expect, it } from 'vitest'
import { isDeployedEnv } from '@/env'

describe('isDeployedEnv', () => {
  it('treats production and staging as live deployments', () => {
    expect(isDeployedEnv('production')).toBe(true)
    expect(isDeployedEnv('staging')).toBe(true)
  })

  it('keeps local OTP and insecure cookies in development', () => {
    expect(isDeployedEnv('development')).toBe(false)
    expect(isDeployedEnv('test')).toBe(false)
  })
})
