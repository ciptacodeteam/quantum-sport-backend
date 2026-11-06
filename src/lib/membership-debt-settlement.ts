export type DebtSettlementPack = {
  id: string
  userId: string
  createdAt: Date
  startDate: Date
  endDate: Date
  remainingSessions: number
  debtSettledSessions: number
  isExpired: boolean
  isSuspended: boolean
  membership: { sport: string }
  invoice: { status: string; paidAt?: Date | null } | null
  debtsReceived: { sessions: number }[]
}
export function compareMembershipPurchases(
  a: Pick<DebtSettlementPack, 'id' | 'createdAt' | 'invoice'>,
  b: Pick<DebtSettlementPack, 'id' | 'createdAt' | 'invoice'>,
) {
  return (
    +(a.invoice?.paidAt ?? a.createdAt) - +(b.invoice?.paidAt ?? b.createdAt) ||
    +a.createdAt - +b.createdAt ||
    a.id.localeCompare(b.id)
  )
}
export function planMembershipDebtSettlement(
  packs: DebtSettlementPack[],
  now = new Date(),
) {
  const ordered = [...packs].sort(compareMembershipPurchases)
  const balances = new Map(
    ordered.map((pack) => [pack.id, pack.remainingSessions]),
  )
  const reviewRequired: string[] = []
  const walletKey = (pack: DebtSettlementPack) =>
    `${pack.userId}|${pack.membership.sport}`
  const blockedWallets = new Set<string>()
  for (const pack of ordered) {
    if (
      pack.invoice?.status === 'PAID' &&
      pack.debtSettledSessions !==
        pack.debtsReceived.reduce((sum, row) => sum + row.sessions, 0)
    ) {
      reviewRequired.push(pack.id)
      blockedWallets.add(walletKey(pack))
    }
  }
  const credits = ordered.filter(
    (pack) =>
      pack.remainingSessions > 0 &&
      pack.invoice?.status === 'PAID' &&
      !pack.isExpired &&
      !pack.isSuspended &&
      pack.endDate > now &&
      !blockedWallets.has(walletKey(pack)),
  )
  const transfers: {
    fromMembershipUserId: string
    toMembershipUserId: string
    sessions: number
  }[] = []
  for (let i = 0; i < ordered.length; i++) {
    const source = ordered[i]
    if (
      source.invoice?.status !== 'PAID' ||
      balances.get(source.id)! >= 0 ||
      blockedWallets.has(walletKey(source))
    )
      continue
    for (const target of credits) {
      if (
        source.userId !== target.userId ||
        source.membership.sport !== target.membership.sport ||
        ordered.indexOf(target) <= i
      )
        continue
      const sessions = Math.min(
        -balances.get(source.id)!,
        balances.get(target.id)!,
      )
      if (sessions <= 0) continue
      transfers.push({
        fromMembershipUserId: source.id,
        toMembershipUserId: target.id,
        sessions,
      })
      balances.set(source.id, balances.get(source.id)! + sessions)
      balances.set(target.id, balances.get(target.id)! - sessions)
      if (balances.get(source.id) === 0) break
    }
  }
  return { transfers, reviewRequired, balances }
}
