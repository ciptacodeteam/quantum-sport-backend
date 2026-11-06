type CustomerAccount = {
  phoneVerified: boolean
  password: string | null
  source: string
  googleId?: string | null
}
/** Legacy walk-ins may have a generated password; source and verification distinguish them. */
export function customerAccountAction(
  user: CustomerAccount | null | undefined,
): 'REGISTER' | 'ACTIVATE' | 'LOGIN' {
  if (!user) return 'REGISTER'
  if (
    !user.phoneVerified &&
    !user.googleId &&
    (user.source === 'WALK_IN' || !user.password)
  )
    return 'ACTIVATE'
  return 'LOGIN'
}
