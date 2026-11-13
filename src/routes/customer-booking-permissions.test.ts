import { Hono } from 'hono'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AppEnv } from '@/types'

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  staff: vi.fn(),
  transaction: vi.fn(),
  invoice: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: { findUnique: mocks.user },
    staff: { findUnique: mocks.staff },
    invoice: { findFirst: mocks.invoice },
    $transaction: mocks.transaction,
  },
}))
import invoiceRoute from './invoice.route'
import adminCourtRoute from './admin/booked-court.route'
import { requireAdminAuth } from '@/middlewares/auth'

function app(authenticated = true) {
  const server = new Hono<AppEnv>()
  server.use('*', async (c, next) => {
    if (authenticated)
      c.set('user', { id: 'customer', phone: '08123456789' })
    await next()
  })
  // This is the same staff gate applied to /admin/* in app.ts.
  server.use('/admin/*', requireAdminAuth)
  server.route('/', invoiceRoute)
  server.route('/admin', adminCourtRoute)
  return server
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({
    id: 'customer',
    banned: false,
    banExpires: null,
    banReason: null,
  })
})

it.each([{}, { reason: 'Cancel', role: 'SUPER_ADMIN' }])(
  'rejects customer cancellation through the legacy invoice API without touching a booking: %o',
  async (body) => {
    const response = await app().request('/invoices/INV-1/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('hanya dapat diproses oleh admin')
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.invoice).not.toHaveBeenCalled()
  },
)
it('requires authentication on the disabled legacy endpoint', async () => {
  expect(
    (
      await app(false).request('/invoices/INV-1/cancel-booking', {
        method: 'POST',
      })
    ).status,
  ).toBe(401)
  expect(mocks.transaction).not.toHaveBeenCalled()
})
it.each(['cancel', 'reschedule', 'change-court'])(
  'does not let a customer use the staff %s endpoint',
  async (action) => {
    const response = await app().request(
      `/admin/booked-courts/detail/${action}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newSlotId: 'target', role: 'SUPER_ADMIN' }),
      },
    )
    expect(response.status).toBe(401)
    expect(mocks.staff).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  },
)
