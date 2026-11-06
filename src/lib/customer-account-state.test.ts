import { expect, it } from 'vitest'
import { customerAccountAction } from './customer-account-state'
const walkin = {
  source: 'WALK_IN',
  phoneVerified: false,
  password: null,
  googleId: null,
}
it('recognizes new numbers and both modern and legacy walk-ins', () => {
  expect(customerAccountAction(null)).toBe('REGISTER')
  expect(customerAccountAction(walkin)).toBe('ACTIVATE')
  expect(
    customerAccountAction({ ...walkin, password: 'generated-phone-hash' }),
  ).toBe('ACTIVATE')
})
it('does not infer activation just because an existing account is unverified', () => {
  expect(
    customerAccountAction({
      ...walkin,
      source: 'ONLINE',
      password: 'chosen-password',
    }),
  ).toBe('LOGIN')
  expect(
    customerAccountAction({
      ...walkin,
      source: 'ADMIN_CREATED',
      password: 'chosen-password',
    }),
  ).toBe('LOGIN')
  expect(customerAccountAction({ ...walkin, phoneVerified: true })).toBe(
    'LOGIN',
  )
  expect(
    customerAccountAction({ ...walkin, googleId: 'google-identity' }),
  ).toBe('LOGIN')
})
