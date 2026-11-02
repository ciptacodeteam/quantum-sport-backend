import { Hono } from 'hono'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ find: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: { invoice: { findUnique: mocks.find } } }))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
import { getInvoiceDetailAdminHandler } from './invoice.handler'

const slot = {
  id: 'slot',
  startAt: new Date('2026-11-01T14:00:00Z'),
  endAt: new Date('2026-11-01T15:00:00Z'),
  staff: { id: 'staff', name: 'Coach' },
}
const app = new Hono().get('/invoices/:id', ...getInvoiceDetailAdminHandler)
beforeEach(() => {
  mocks.find.mockResolvedValue({
    id: 'invoice',
    number: 'INV-261101-TEST',
    bookingId: 'booking',
    status: 'PAID',
    issuedAt: new Date('2026-11-01T06:46:00Z'),
    paidAt: new Date('2026-11-01T06:46:00Z'),
    dueDate: new Date('2026-11-01T06:51:00Z'),
    user: { name: 'Erica' },
    subtotal: 250000,
    total: 250000,
    processingFee: 0,
    booking: {
      id: 'booking',
      status: 'CONFIRMED',
      details: [
        {
          court: { name: 'Court 1 Tennis' },
          slot,
          price: 250000,
          discountPrice: 250000,
        },
      ],
      coaches: [{ slot, price: 100000, bookingCoachType: { name: 'Private' } }],
      ballboys: [{ slot, price: 50000 }],
      inventories: [],
    },
    membershipUser: null,
  })
})
afterEach(() => vi.unstubAllEnvs())

it.each(['UTC', 'Asia/Jakarta'])(
  'serializes all invoice slot times like the schedule on a %s host',
  async (timezone) => {
    vi.stubEnv('TZ', timezone)
    const response = await app.request('/invoices/invoice')
    expect(response.status).toBe(200)
    const body = (await response.json()) as any
    for (const section of ['courts', 'coaches', 'ballboys']) {
      expect(body.data.booking[section][0].slot).toMatchObject({
        startAt: '2026-11-01 14:00:00',
        endAt: '2026-11-01 15:00:00',
        date: '2026-11-01',
        startTime: '14:00',
        endTime: '15:00',
      })
    }
    // Financial timestamps remain real UTC instants; only slot walls are normalized.
    expect(body.data.issuedAt).toBe('2026-11-01T06:46:00.000Z')
    expect(body.data.paidAt).toBe('2026-11-01T06:46:00.000Z')
  },
)

it('retains the playing date across midnight without adding seven hours', async () => {
  const invoice = await mocks.find()
  invoice.booking.details[0].slot = {
    ...slot,
    startAt: new Date('2026-10-31T23:00:00Z'),
    endAt: new Date('2026-11-01T00:00:00Z'),
  }
  mocks.find.mockResolvedValue(invoice)
  const body = (await (await app.request('/invoices/invoice')).json()) as any
  expect(body.data.booking.courts[0].slot).toMatchObject({
    startAt: '2026-10-31 23:00:00',
    endAt: '2026-11-01 00:00:00',
    date: '2026-10-31',
    startTime: '23:00',
    endTime: '00:00',
  })
})
