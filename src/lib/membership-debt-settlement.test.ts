import { expect, it } from 'vitest'
import {
  planMembershipDebtSettlement,
  type DebtSettlementPack,
} from './membership-debt-settlement'
const now = new Date('2026-11-06T05:00:00Z')
const pack = (
  id: string,
  balance: number,
  date: string,
  patch: Partial<DebtSettlementPack> = {},
): DebtSettlementPack => ({
  id,
  userId: 'customer',
  createdAt: new Date(date),
  startDate: new Date(date),
  endDate: new Date('2027-11-01'),
  remainingSessions: balance,
  debtSettledSessions: 0,
  isExpired: false,
  isSuspended: false,
  membership: { sport: 'TENNIS' },
  invoice: { status: 'PAID' },
  debtsReceived: [],
  ...patch,
})
it('settles the Robin and JIM examples independently by customer id', () => {
  const result = planMembershipDebtSettlement(
    [
      pack('robin-old', -4, '2025-12-03', { userId: 'robin' }),
      pack('robin-new', 26, '2026-09-21', { userId: 'robin' }),
      pack('jim-old', -2, '2026-01-01', { userId: 'jim' }),
      pack('jim-new', 24, '2026-09-29', { userId: 'jim' }),
    ],
    now,
  )
  expect(Object.fromEntries(result.balances)).toEqual({
    'robin-old': 0,
    'robin-new': 22,
    'jim-old': 0,
    'jim-new': 22,
  })
  expect(result.transfers.reduce((sum, row) => sum + row.sessions, 0)).toBe(6)
})
it('uses only available quota and leaves any uncovered debt on the old package', () => {
  const result = planMembershipDebtSettlement(
    [pack('old', -12, '2025-12-03'), pack('new', 10, '2026-09-21')],
    now,
  )
  expect(result.balances.get('old')).toBe(-2)
  expect(result.balances.get('new')).toBe(0)
  expect(result.transfers[0].sessions).toBe(10)
})
it('never crosses customers or sports, and only newer paid active packages may fund debt', () => {
  const old = pack('old', -4, '2025-12-03')
  for (const patch of [
    { userId: 'another' },
    { membership: { sport: 'PADEL' } },
    { invoice: { status: 'PENDING' } },
    { invoice: { status: 'CANCELLED' } },
    { isSuspended: true },
    { isExpired: true },
    { endDate: new Date('2026-10-01') },
    { createdAt: new Date('2025-01-01') },
  ])
    expect(
      planMembershipDebtSettlement(
        [old, pack('new', 26, '2026-09-21', patch)],
        now,
      ).transfers,
    ).toEqual([])
})
it('skips ambiguous legacy deductions instead of charging an already-recorded amount twice', () => {
  const result = planMembershipDebtSettlement(
    [
      pack('old', -4, '2025-12-03'),
      pack('new', 26, '2026-09-21', { debtSettledSessions: 4 }),
    ],
    now,
  )
  expect(result.transfers).toEqual([])
  expect(result.reviewRequired).toEqual(['new'])
})
it('keeps past recorded debt payments and applies only current outstanding balances', () => {
  const result = planMembershipDebtSettlement(
    [
      pack('settled-old', 0, '2025-12-03'),
      pack('new-debt', -2, '2026-01-01'),
      pack('new', 26, '2026-09-21', {
        debtSettledSessions: 4,
        debtsReceived: [{ sessions: 4 }],
      }),
    ],
    now,
  )
  expect(result.transfers).toEqual([
    {
      fromMembershipUserId: 'new-debt',
      toMembershipUserId: 'new',
      sessions: 2,
    },
  ])
  expect(result.balances.get('new')).toBe(24)
})
it('settles oldest debt first without making a funding package negative', () => {
  const result = planMembershipDebtSettlement(
    [
      pack('old-a', -3, '2025-01-01'),
      pack('old-b', -4, '2025-02-01'),
      pack('new-a', 5, '2026-01-01'),
      pack('new-b', 6, '2026-02-01'),
    ],
    now,
  )
  expect(result.transfers.map((row) => row.sessions)).toEqual([3, 2, 2])
  expect(result.balances.get('new-a')).toBe(0)
  expect(result.balances.get('new-b')).toBe(4)
})

it('uses payment chronology for imported records and preserves the chosen future start date', () => {
  const old = pack('old', -4, '2026-10-01', {
    invoice: { status: 'PAID', paidAt: new Date('2025-12-03') },
  })
  const newer = pack('new', 26, '2026-09-01', {
    invoice: { status: 'PAID', paidAt: new Date('2026-09-21') },
    startDate: new Date('2026-12-01'),
  })
  const result = planMembershipDebtSettlement([newer, old], now)
  expect(result.balances.get('old')).toBe(0)
  expect(result.balances.get('new')).toBe(22)
  expect(newer.startDate).toEqual(new Date('2026-12-01'))
})
it('does not charge another fresh purchase when existing settlement history needs review', () => {
  const result = planMembershipDebtSettlement(
    [
      pack('old', -4, '2025-01-01'),
      pack('ambiguous', 26, '2026-01-01', { debtSettledSessions: 4 }),
      pack('fresh', 30, '2026-02-01'),
    ],
    now,
  )
  expect(result.transfers).toEqual([])
  expect(result.reviewRequired).toEqual(['ambiguous'])
  expect(result.balances.get('fresh')).toBe(30)
})
