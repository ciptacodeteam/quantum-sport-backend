import { expect, it } from 'vitest'
import {
  assertCourtSportAtBranch,
  supportedCourtWhere,
  bookableCourtWhere,
} from './court-branch-policy'
it('allows Tennis only in Cemara', () => {
  expect(() => assertCourtSportAtBranch('TENNIS', 'cemara')).not.toThrow()
  for (const branch of ['s-parman', 'new-branch', null])
    expect(() => assertCourtSportAtBranch('TENNIS', branch)).toThrow(
      'Tennis hanya tersedia di cabang Cemara.',
    )
})
it('keeps Padel available across branches and filters unsupported courts at query time', () => {
  expect(() => assertCourtSportAtBranch('PADEL', 's-parman')).not.toThrow()
  expect(supportedCourtWhere).toEqual({
    NOT: { sport: 'TENNIS', branchId: { not: 'cemara' } },
  })
  expect(bookableCourtWhere).toMatchObject({
    isActive: true,
    ...supportedCourtWhere,
  })
})
