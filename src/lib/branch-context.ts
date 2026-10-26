import { AsyncLocalStorage } from 'node:async_hooks'

export type BranchContext = {
  branchId: string | null
  isAdmin: boolean
  isSuperAdmin: boolean
  membershipMode?: 'wallet' | 'sales'
  staffId?: string
  // Newly created records can be referenced inside the same transaction before commit.
  created: Map<string, Set<string>>
}
export const branchContext = new AsyncLocalStorage<BranchContext>()
export function withBranchContext<T>(
  context: Omit<BranchContext, 'created'>,
  callback: () => T,
): Promise<Awaited<T>> {
  return branchContext.run(
    { ...context, created: new Map() },
    async () => await callback(),
  ) as Promise<Awaited<T>>
}
