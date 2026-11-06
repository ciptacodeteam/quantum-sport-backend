import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/prisma'
import { createRouter } from '@/lib/create-app'
import { withBranchContext } from '@/lib/branch-context'
import { clubNowAsWallDate } from '@/lib/club-time'
import { createInternalCourtBookingHandler } from '@/handlers/admin/internal-court-booking.handler'
import {
  cancelBookingHandler,
  rescheduleCourtBookingHandler,
} from '@/handlers/admin/booked-court.handler'
import { getAllBookingScheduleHandler } from '@/handlers/admin/booking.handler'
import {
  getCourtBookingList,
  courtBookingListSchema,
} from './court-booking-list.service'
import { createInternalCourtBooking } from './internal-court-booking.service'

const run =
  process.env.RUN_INTERNAL_BOOKING_DB_TESTS === '1' ? describe : describe.skip
run('internal court bookings against local PostgreSQL', () => {
  const prefix = `internal-booking-test-${Date.now()}`
  const branchId = `${prefix}-branch`,
    otherBranch = `${prefix}-other`
  const userId = `${prefix}-user`,
    staffId = `${prefix}-staff`,
    courtId = `${prefix}-court`
  const slotIds = [0, 1, 2].map((i) => `${prefix}-slot-${i}`)
  const startAt = new Date(+clubNowAsWallDate() + 5 * 86400000)
  startAt.setUTCMinutes(0, 0, 0)
  const app = createRouter()
  app.use('*', async (c, next) => {
    c.set('admin', { id: staffId } as never)
    c.set('logger', { fatal: () => {} } as never)
    await next()
  })
  app.post('/internal', ...createInternalCourtBookingHandler)
  app.put('/:id/cancel', ...cancelBookingHandler)
  app.put('/details/:id/reschedule', ...rescheduleCourtBookingHandler)
  app.get('/schedule', ...getAllBookingScheduleHandler)
  const asBranch = <T>(callback: () => T, selectedBranch = branchId) =>
    withBranchContext(
      { branchId: selectedBranch, isAdmin: true, isSuperAdmin: true },
      callback,
    )
  const input = (slotId: string) => ({
    purpose: 'COACH_TRAINING' as const,
    activityName: 'Coach Andi',
    userId,
    courtSlots: [slotId],
  })
  beforeAll(async () => {
    await db.branch.createMany({
      data: [branchId, otherBranch].map((id) => ({
        id,
        name: id,
        address: 'Integration test',
      })),
    })
    await db.user.create({ data: { id: userId, name: prefix, phone: prefix } })
    await db.staff.create({
      data: {
        id: staffId,
        branchId,
        name: prefix,
        email: `${prefix}@example.invalid`,
        password: 'test-only',
      },
    })
    await db.court.create({ data: { id: courtId, branchId, name: prefix } })
    await db.slot.createMany({
      data: slotIds.map((id, i) => ({
        id,
        branchId,
        courtId,
        type: 'COURT',
        price: 250000,
        discountPrice: 200000,
        startAt: new Date(+startAt + i * 3600000),
        endAt: new Date(+startAt + (i + 1) * 3600000),
      })),
    })
  })
  afterAll(async () => {
    await db.booking.deleteMany({ where: { userId } })
    await db.slot.deleteMany({ where: { id: { in: slotIds } } })
    await db.court.deleteMany({ where: { id: courtId } })
    await db.staff.deleteMany({ where: { id: staffId } })
    await db.user.deleteMany({ where: { id: userId } })
    await db.branch.deleteMany({
      where: { id: { in: [branchId, otherBranch] } },
    })
  })

  it('accepts admin bookings and exposes their activity on the shared schedule without financial records', async () => {
    const response = await asBranch(() =>
      app.request('/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input(slotIds[0])),
      }),
    )
    expect(response.status, await response.clone().text()).toBe(201)
    const { data } = (await response.json()) as any
    const saved = await db.booking.findUniqueOrThrow({
      where: { id: data.id },
      include: { details: true, invoice: true },
    })
    expect(saved).toMatchObject({
      branchId,
      purpose: 'COACH_TRAINING',
      activityName: 'Coach Andi',
      status: 'CONFIRMED',
      totalPrice: 0,
      processingFee: 0,
      membershipUserId: null,
      membershipSessionsUsed: 0,
      invoice: null,
    })
    expect(saved.details[0]).toMatchObject({ price: 0, discountPrice: 0 })
    expect(
      (await db.slot.findUniqueOrThrow({ where: { id: slotIds[0] } }))
        .isAvailable,
    ).toBe(false)
    expect(await db.invoice.count({ where: { bookingId: saved.id } })).toBe(0)
    const schedule = await asBranch(() =>
      app.request(
        `/schedule?date=${startAt.toISOString().slice(0, 10)}&courtSport=PADEL`,
      ),
    )
    expect(((await schedule.json()) as any).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: saved.id,
          purpose: 'COACH_TRAINING',
          activityName: 'Coach Andi',
        }),
      ]),
    )
    const list = await asBranch(() =>
      getCourtBookingList(
        courtBookingListSchema.parse({ search: 'Coach Andi' }),
      ),
    )
    expect(list.items.some((booking) => booking.id === saved.id)).toBe(true)

    // Reuse the existing reschedule operation and retain zero-valued details.
    const move = await asBranch(() =>
      app.request(`/details/${saved.details[0].id}/reschedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newSlotId: slotIds[1] }),
      }),
    )
    expect(move.status, await move.clone().text()).toBe(200)
    expect(
      await db.bookingDetail.findUniqueOrThrow({
        where: { id: saved.details[0].id },
      }),
    ).toMatchObject({ slotId: slotIds[1], price: 0, discountPrice: 0 })

    const cancel = await asBranch(() =>
      app.request(`/${saved.id}/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Test cancellation' }),
      }),
    )
    expect(cancel.status, await cancel.clone().text()).toBe(200)
    expect(
      (await db.slot.findUniqueOrThrow({ where: { id: slotIds[1] } }))
        .isAvailable,
    ).toBe(true)
    const rebooked = await asBranch(() =>
      createInternalCourtBooking(
        { ...input(slotIds[1]), purpose: 'EVENT', activityName: 'Club event' },
        staffId,
      ),
    )
    expect(rebooked.purpose).toBe('EVENT')
  })

  it('allows only one simultaneous booking of a slot', async () => {
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        asBranch(() => createInternalCourtBooking(input(slotIds[2]), staffId)),
      ),
    )
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    expect(
      await db.bookingDetail.count({
        where: { slotId: slotIds[2], booking: { status: 'CONFIRMED' } },
      }),
    ).toBe(1)
  })

  it('cannot reserve a court belonging to a different branch', async () => {
    await expect(
      asBranch(
        () => createInternalCourtBooking(input(slotIds[0]), staffId),
        otherBranch,
      ),
    ).rejects.toThrow('tidak tersedia')
    expect(
      (await db.slot.findUniqueOrThrow({ where: { id: slotIds[0] } }))
        .isAvailable,
    ).toBe(true)
  })
})
