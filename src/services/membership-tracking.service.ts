type PackageState = {
  startDate: Date
  endDate: Date
  remainingSessions: number
  isExpired: boolean
  isSuspended: boolean
  invoice?: { status: string } | null
}
export function getTrackedPackageStatus(pack: PackageState, now = new Date()) {
  if (pack.invoice && pack.invoice.status !== 'PAID') {
    return ['PENDING', 'HOLD', 'AWAITING_CONFIRMATION'].includes(
      pack.invoice.status,
    )
      ? 'PENDING'
      : 'PAYMENT_FAILED'
  }
  if (pack.endDate <= now) return 'EXPIRED'
  if (pack.isSuspended) return 'SUSPENDED'
  if (pack.remainingSessions <= 0) return 'EXHAUSTED'
  if (pack.isExpired) return 'EXPIRED'
  if (pack.startDate > now) return 'UPCOMING'
  return 'ACTIVE'
}
