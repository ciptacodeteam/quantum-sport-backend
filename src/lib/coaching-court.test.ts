import { expect, it } from 'vitest'
import { findCoachingCourt } from './coaching-court'

const hour = {
  startAt: new Date('2026-11-25T17:00:00Z'),
  endAt: new Date('2026-11-25T18:00:00Z'),
}
it('links the unique court for the service hour across a multi-hour booking', () => {
  const court = { ...hour, id: 'court-7' }
  expect(
    findCoachingCourt(hour, [
      {
        id: 'earlier',
        startAt: new Date('2026-11-25T16:00:00Z'),
        endAt: hour.startAt,
      },
      court,
    ]),
  ).toBe(court)
})
it('does not guess a court for standalone or ambiguous coaching', () => {
  expect(findCoachingCourt(hour, [])).toBeUndefined()
  expect(
    findCoachingCourt(hour, [
      { ...hour, id: 'a' },
      { ...hour, id: 'b' },
    ]),
  ).toBeUndefined()
  expect(
    findCoachingCourt(hour, [
      { ...hour, endAt: new Date('2026-11-25T19:00:00Z') },
    ]),
  ).toBeUndefined()
})
