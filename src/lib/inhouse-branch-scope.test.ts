import { expect, it } from 'vitest'
import { branchWhere } from './branch-scope'
it.each(['InHousePlan', 'InHouseWallet', 'InHouseUsage'])(
  'scopes %s to the selected branch',
  (model) => {
    expect(
      branchWhere(model, {
        branchId: 'cemara',
        isAdmin: true,
        isSuperAdmin: false,
      }),
    ).toEqual({ branchId: 'cemara' })
    expect(
      branchWhere(model, {
        branchId: 'other',
        isAdmin: true,
        isSuperAdmin: true,
      }),
    ).toEqual({ branchId: 'other' })
  },
)
