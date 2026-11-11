import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ claim: vi.fn() }))
vi.mock('./slot-claim.service', () => ({ claimSlotsAtomically: mocks.claim }))
import { rescheduleCourtServices } from './reschedule-court-services.service'
const source = {
  id: 'old-court',
  startAt: new Date('2040-01-05T09:00:00Z'),
  endAt: new Date('2040-01-05T10:00:00Z'),
}
const target = {
  id: 'new-court',
  startAt: new Date('2040-01-08T10:00:00Z'),
  endAt: new Date('2040-01-08T11:00:00Z'),
}
const service = (kind: string) => ({
  id: kind,
  bookingId: `${kind}-invoice-booking`,
  slotId: `old-${kind}`,
  courtSlotId: source.id,
  slot: { ...source, id: `old-${kind}`, staffId: kind },
})
let tx: any
beforeEach(() => {
  vi.clearAllMocks()
  tx = {
    $queryRaw: vi.fn(),
    bookingDetail: { count: vi.fn().mockResolvedValue(1) },
    bookingCoach: {
      findMany: vi.fn().mockResolvedValue([service('coach')]),
      update: vi.fn(),
    },
    bookingBallboy: {
      findMany: vi.fn().mockResolvedValue([service('ballboy')]),
      update: vi.fn(),
    },
    slot: {
      findFirst: vi
        .fn()
        .mockImplementation(({ where }) => ({ id: `new-${where.staffId}` })),
      updateMany: vi.fn(),
    },
  }
})
it('moves separately invoiced coach and ballboy together and updates their court linkage', async () => {
  await rescheduleCourtServices(tx, 'court-booking', source, target, 'cemara')
  expect(tx.bookingCoach.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ courtSlotId: 'old-court' }]),
      }),
    }),
  )
  expect(mocks.claim).toHaveBeenCalledTimes(2)
  expect(tx.bookingCoach.update).toHaveBeenCalledWith({
    where: { id: 'coach' },
    data: { slotId: 'new-coach', courtSlotId: 'new-court' },
  })
  expect(tx.bookingBallboy.update).toHaveBeenCalledWith({
    where: { id: 'ballboy' },
    data: { slotId: 'new-ballboy', courtSlotId: 'new-court' },
  })
  expect(tx.slot.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(
    tx.bookingBallboy.update.mock.invocationCallOrder[0],
  )
})
it('does not claim or move anything when the assigned ballboy is unavailable', async () => {
  tx.slot.findFirst.mockImplementation(({ where }: any) =>
    where.type === 'BALLBOY' ? null : { id: 'new-coach' },
  )
  await expect(
    rescheduleCourtServices(tx, 'court-booking', source, target, 'cemara'),
  ).rejects.toThrow(/Ballboy/)
  expect(mocks.claim).not.toHaveBeenCalled()
  expect(tx.bookingCoach.update).not.toHaveBeenCalled()
  expect(tx.slot.updateMany).not.toHaveBeenCalled()
})
it('fails the transaction when an atomic service claim loses a race', async () => {
  mocks.claim.mockRejectedValueOnce(
    new Error('Jadwal layanan baru saja dipesan'),
  )
  await expect(
    rescheduleCourtServices(tx, 'court-booking', source, target, 'cemara'),
  ).rejects.toThrow(/baru saja/)
  expect(tx.bookingCoach.update).not.toHaveBeenCalled()
  expect(tx.slot.updateMany).not.toHaveBeenCalled()
})
it('only relinks the court when the date and time have not changed', async () => {
  await rescheduleCourtServices(
    tx,
    'court-booking',
    source,
    { ...source, id: 'other-court' },
    'cemara',
  )
  expect(mocks.claim).not.toHaveBeenCalled()
  expect(tx.slot.findFirst).not.toHaveBeenCalled()
  expect(tx.bookingCoach.update).toHaveBeenCalledWith({
    where: { id: 'coach' },
    data: { slotId: 'old-coach', courtSlotId: 'other-court' },
  })
  expect(tx.slot.updateMany).not.toHaveBeenCalled()
})
it('rejects ambiguous legacy service attribution across simultaneous courts', async () => {
  tx.bookingCoach.findMany.mockResolvedValue([
    { ...service('coach'), courtSlotId: null },
  ])
  tx.bookingDetail.count.mockResolvedValue(2)
  await expect(
    rescheduleCourtServices(tx, 'court-booking', source, target, 'cemara'),
  ).rejects.toThrow(/paralel/)
  expect(mocks.claim).not.toHaveBeenCalled()
})
it('keeps a plain court reschedule independent from coaching', async () => {
  tx.bookingCoach.findMany.mockResolvedValue([])
  tx.bookingBallboy.findMany.mockResolvedValue([])
  await rescheduleCourtServices(tx, 'court-booking', source, target, 'cemara')
  expect(mocks.claim).not.toHaveBeenCalled()
  expect(tx.slot.findFirst).not.toHaveBeenCalled()
})

it('detects a legacy service crossing the court hour and refuses to leave it behind', async () => {
  tx.bookingCoach.findMany.mockResolvedValue([
    {
      ...service('coach'),
      courtSlotId: null,
      slot: {
        ...source,
        id: 'old-coach',
        staffId: 'coach',
        endAt: new Date(+source.endAt + 3600000),
      },
    },
  ])
  await expect(
    rescheduleCourtServices(tx, 'court-booking', source, target, 'cemara'),
  ).rejects.toThrow(/melewati/)
  expect(tx.bookingCoach.findMany.mock.calls[0][0].where.OR[1].slot).toEqual({
    startAt: { lt: source.endAt },
    endAt: { gt: source.startAt },
  })
  expect(mocks.claim).not.toHaveBeenCalled()
  expect(tx.bookingCoach.update).not.toHaveBeenCalled()
})
