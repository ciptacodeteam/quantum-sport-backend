import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ cancel: vi.fn() }))
vi.mock('@/handlers/admin/booked-court.handler', () => ({
  getAllBookedCourtsHandler: [],
  getBookedCourtDetailHandler: [],
  getBookedCourtsSummaryHandler: [],
  getBookingsByCourtHandler: [],
  rescheduleCourtBookingHandler: [],
  cancelBookingHandler: [
    (c: any) => {
      mocks.cancel()
      return c.json({ ok: true })
    },
  ],
}))
vi.mock('@/handlers/admin/booking.handler', () => ({
  approveBookingTransactionHandler: [],
  exportBookingTransactionsToExcelHandler: [],
  exportBookingsHandler: [],
  getAllBookingTransactionsHandler: [],
  getCourtBookingTableHandler: [],
  getAllBookingScheduleHandler: [],
  getBookingTransactionDetailHandler: [],
  rejectBookingTransactionHandler: [
    (c: any) => {
      mocks.cancel()
      return c.json({ ok: true })
    },
  ],
  getOngoingBookingScheduleHandler: [],
}))
vi.mock('@/handlers/admin/recurring-booking.handler', () => ({
  previewRecurringBookingHandler: [],
  listRecurringBookingsHandler: [],
  stopRecurringBookingHandler: [],
}))
vi.mock('@/handlers/admin/internal-court-booking.handler', () => ({
  createInternalCourtBookingHandler: [],
}))
vi.mock('@/handlers/admin/court-change.handler', () => ({
  adminCourtChangeOptionsHandler: [],
  adminChangeCourtHandler: [],
}))
import bookings from './booking.route'
import courts from './booked-court.route'
function app(role?: string) {
  const a = new Hono<any>()
  a.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  a.route('/admin', bookings)
  a.route('/admin', courts)
  return a
}
beforeEach(() => vi.clearAllMocks())
it.each(['ADMIN', 'SUPER_ADMIN'])(
  'allows %s to cancel through either booking endpoint',
  async (role) => {
    for (const path of [
      'bookings/booking-id/cancel',
      'booked-courts/booking-id/cancel',
      'bookings/booking-id/reject',
    ]) {
      expect(
        (
          await app(role).request(`/admin/${path}`, {
            method: 'PUT',
          })
        ).status,
      ).toBe(200)
    }
    expect(mocks.cancel).toHaveBeenCalledTimes(3)
  },
)
it.each(['CASHIER', 'ADMIN_VIEWER', 'COACH', 'BALLBOY', undefined])(
  'blocks %s from cancelling through either endpoint',
  async (role) => {
    for (const path of [
      'bookings/booking-id/cancel',
      'booked-courts/booking-id/cancel',
      'bookings/booking-id/reject',
    ]) {
      expect(
        (
          await app(role).request(`/admin/${path}`, {
            method: 'PUT',
          })
        ).status,
      ).toBe(role ? 403 : 401)
    }
    expect(mocks.cancel).not.toHaveBeenCalled()
  },
)
