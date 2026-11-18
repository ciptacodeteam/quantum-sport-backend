import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { booking: { findFirst: mocks.find, updateMany: mocks.update } },
}))
import { updateBookingDescriptionHandler } from './booking-description.handler'
const history = '[COURT_CHANGE] {"existing":"audit"}'
const original = 'Pak Alvin\n' + history
beforeEach(() => {
  vi.clearAllMocks()
  mocks.find.mockResolvedValue({ id: 'booking', adminNote: original })
  mocks.update.mockResolvedValue({ count: 1 })
})
function request(body: unknown, role: string | null = 'ADMIN') {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  app.put('/:id/description', ...updateBookingDescriptionHandler)
  return app.request('/booking/description', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
it.each(['ADMIN', 'SUPER_ADMIN', 'CASHIER'])(
  'allows %s to edit only the description and preserves raw history',
  async (role) => {
    const res = await request(
      { description: '  Pak Alvin baru  ', expectedAdminNote: original },
      role,
    )
    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'booking', adminNote: original },
      data: { adminNote: 'Pak Alvin baru\n' + history },
    })
    expect(await res.json()).toMatchObject({
      data: { adminNote: 'Pak Alvin baru\n' + history },
    })
  },
)
it.each([null, 'ADMIN_VIEWER', 'COACH', 'BALLBOY'])(
  'blocks edits by %s',
  async (role) => {
    expect(
      (await request({ description: 'new', expectedAdminNote: original }, role))
        .status,
    ).toBe(role ? 403 : 401)
    expect(mocks.find).not.toHaveBeenCalled()
  },
)
it('allows clearing the description without deleting history', async () => {
  expect(
    (await request({ description: '', expectedAdminNote: original })).status,
  ).toBe(200)
  expect(mocks.update.mock.lastCall?.[0].data).toEqual({ adminNote: history })
})
it('adds a description to a booking without a note', async () => {
  mocks.find.mockResolvedValue({ id: 'booking', adminNote: null })
  expect(
    (await request({ description: 'new', expectedAdminNote: null })).status,
  ).toBe(200)
  expect(mocks.update.mock.lastCall?.[0].data).toEqual({ adminNote: 'new' })
})
it('rejects stale data and concurrent changes instead of overwriting notes', async () => {
  expect(
    (await request({ description: 'new', expectedAdminNote: 'old' })).status,
  ).toBe(409)
  expect(mocks.update).not.toHaveBeenCalled()
  mocks.update.mockResolvedValue({ count: 0 })
  expect(
    (await request({ description: 'new', expectedAdminNote: original })).status,
  ).toBe(409)
})
it('handles a missing or inaccessible booking', async () => {
  mocks.find.mockResolvedValue(null)
  expect(
    (await request({ description: 'new', expectedAdminNote: original })).status,
  ).toBe(404)
  expect(mocks.update).not.toHaveBeenCalled()
})
it('validates description length and prevents replacing audit markers', async () => {
  expect(
    (
      await request({
        description: 'a'.repeat(1001),
        expectedAdminNote: original,
      })
    ).status,
  ).toBe(422)
  expect(
    (await request({ description: history, expectedAdminNote: original }))
      .status,
  ).toBe(400)
  expect(mocks.update).not.toHaveBeenCalled()
})
