import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { booking: { findMany: mocks.findMany } },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
import {
  getAllBookingTransactionsHandler,
  exportBookingsHandler,
} from './booking.handler'
import { bookingCheckoutWhere } from '@/lib/booking-checkout'

const context = (query: Record<string, string>) => ({
  req: { valid: () => query },
  var: { logger: { fatal: vi.fn() } },
  header: vi.fn(),
  json: (body: unknown) => body,
  body: (body: unknown) => body,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.findMany.mockResolvedValue([])
})
it('uses recorded membership usage, including legacy usage, rather than membership ownership', () => {
  expect(bookingCheckoutWhere('membership')).toEqual({
    OR: [
      { membershipUserId: { not: null } },
      { membershipSessionsUsed: { gt: 0 } },
    ],
  })
  expect(bookingCheckoutWhere('regular')).toEqual({
    membershipUserId: null,
    membershipSessionsUsed: 0,
  })
  expect(bookingCheckoutWhere()).toEqual({})
})
it.each(['regular', 'membership'] as const)(
  'applies the same %s checkout filter to the table and Excel export without losing sport filters',
  async (checkoutType) => {
    await (getAllBookingTransactionsHandler[1] as any)(
      context({ checkoutType, courtSport: 'PADEL' }),
    )
    const listing = mocks.findMany.mock.calls[0][0].where
    expect(listing.AND[1]).toEqual(bookingCheckoutWhere(checkoutType))
    expect(listing.AND[0].OR).toBeDefined()
    expect(JSON.stringify(listing.AND[0])).toContain('PADEL')
    mocks.findMany.mockClear()
    await (exportBookingsHandler[1] as any)(
      context({ checkoutType, courtSport: 'PADEL' }),
    )
    const exported = mocks.findMany.mock.calls[0][0].where
    expect(exported.AND).toEqual([bookingCheckoutWhere(checkoutType)])
    expect(exported.details.some.court.sport).toBe('PADEL')
  },
)
it('does not restrict checkout type when all checkouts are requested', async () => {
  await (getAllBookingTransactionsHandler[1] as any)(
    context({ courtSport: 'TENNIS' }),
  )
  expect(mocks.findMany.mock.calls[0][0].where.AND).toBeUndefined()
})
