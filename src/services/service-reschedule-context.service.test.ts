import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  coach: vi.fn(),
  ballboy: vi.fn(),
  details: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    bookingCoach: { findFirst: mocks.coach },
    bookingBallboy: { findFirst: mocks.ballboy },
    bookingDetail: { findMany: mocks.details },
  },
}))
import { serviceRescheduleContext } from './service-reschedule-context.service'
const item = {
  id: 'service',
  status: 'CONFIRMED',
  courtSlotId: 'court-slot',
  bookingId: 'service-booking',
  slot: {
    startAt: new Date('2040-01-05T09:00:00Z'),
    endAt: new Date('2040-01-05T10:00:00Z'),
  },
  booking: {
    userId: 'customer',
    status: 'CONFIRMED',
    serviceForBookingId: 'court-booking',
    invoice: { status: 'PAID' },
  },
}
const detail = {
  id: 'detail',
  discountPrice: 150000,
  booking: {
    status: 'CONFIRMED',
    userId: 'customer',
    membershipSessionsUsed: 0,
    invoice: { status: 'PAID' },
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.coach.mockResolvedValue(item)
  mocks.ballboy.mockResolvedValue(item)
  mocks.details.mockResolvedValue([detail])
})
it.each(['COACH', 'BALLBOY'] as const)(
  'resolves the linked parent court for active %s',
  async (kind) => {
    expect(await serviceRescheduleContext(kind, 'service')).toEqual({
      detail: { id: 'detail', discountPrice: 150000 },
      membershipCovered: false,
    })
    expect(mocks.details.mock.calls[0][0].where).toMatchObject({
      bookingId: 'court-booking',
      slotId: 'court-slot',
      booking: { status: 'CONFIRMED' },
    })
  },
)
it('resolves legacy service links without a parent booking ID', async () => {
  mocks.ballboy.mockResolvedValue({
    ...item,
    booking: { ...item.booking, serviceForBookingId: null },
  })
  await serviceRescheduleContext('BALLBOY', 'service')
  expect(mocks.details.mock.calls[0][0].where).not.toHaveProperty('bookingId')
})
it('rejects a cancelled service before reading target court details', async () => {
  mocks.ballboy.mockResolvedValue({ ...item, status: 'CANCELLED' })
  await expect(serviceRescheduleContext('BALLBOY', 'service')).rejects.toThrow(
    /aktif/,
  )
  expect(mocks.details).not.toHaveBeenCalled()
})
it('rejects missing, ambiguous, unpaid and mismatched court links', async () => {
  mocks.details
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([detail, detail])
    .mockResolvedValueOnce([
      {
        ...detail,
        booking: { ...detail.booking, invoice: { status: 'CANCELLED' } },
      },
    ])
    .mockResolvedValueOnce([
      { ...detail, booking: { ...detail.booking, userId: 'another' } },
    ])
  for (let i = 0; i < 4; i++)
    await expect(serviceRescheduleContext('COACH', 'service')).rejects.toThrow()
})
