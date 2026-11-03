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
  getAllBookingScheduleHandler,
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

it('limits schedule to the selected WIB slot day while preserving tennis and service bookings', async () => {
  await (getAllBookingScheduleHandler[1] as any)(
    context({ courtSport: 'TENNIS', date: '2026-11-03' }),
  )
  const options = mocks.findMany.mock.calls[0][0]
  const [base, day] = options.where.AND
  expect(base.status).toEqual({ not: 'CANCELLED' })
  expect(JSON.stringify(base.OR)).toContain('TENNIS')
  expect(base.createdAt).toBeUndefined()
  for (const [index, relation] of [
    'details',
    'coaches',
    'ballboys',
    'inventories',
  ].entries()) {
    expect(day.OR[index][relation].some.slot.startAt).toEqual({
      gte: new Date('2026-11-03T00:00:00Z'),
      lt: new Date('2026-11-04T00:00:00Z'),
    })
  }
  expect(options.include.user.select.image).toBeUndefined()
  expect(options.include.details.include.court.select.image).toBeUndefined()
})
it('keeps schedule requests without a date compatible', async () => {
  await (getAllBookingScheduleHandler[1] as any)(
    context({ courtSport: 'PADEL' }),
  )
  const { where } = mocks.findMany.mock.calls[0][0]
  expect(where.AND).toBeUndefined()
  expect(JSON.stringify(where.OR)).toContain('PADEL')
})

it.each(['PADEL', 'TENNIS'])(
  'filters %s playing dates identically in table and export without losing checkout or source filters',
  async (courtSport) => {
    const query = {
      courtSport,
      checkoutType: 'membership',
      source: 'cashier',
      dateFrom: '2026-11-03',
      dateTo: '2026-11-04',
    }
    await (getAllBookingTransactionsHandler[1] as any)(context(query))
    const listing = mocks.findMany.mock.calls[0][0].where
    const dateFilter = {
      details: {
        some: {
          court: { sport: courtSport },
          slot: {
            startAt: {
              gte: new Date('2026-11-03T00:00:00Z'),
              lt: new Date('2026-11-05T00:00:00Z'),
            },
          },
        },
      },
    }
    expect(listing.AND[1]).toEqual(dateFilter)
    expect(listing.AND[0].AND[0].cashierId).toEqual({ not: null })
    expect(listing.AND[0].AND[1]).toEqual(bookingCheckoutWhere('membership'))
    expect(listing.createdAt).toBeUndefined()
    mocks.findMany.mockClear()
    await (exportBookingsHandler[1] as any)(context(query))
    const exported = mocks.findMany.mock.calls[0][0].where
    expect(exported.AND).toContainEqual(dateFilter)
    expect(exported.AND).toContainEqual(bookingCheckoutWhere('membership'))
    expect(exported.cashierId).toEqual({ not: null })
  },
)
