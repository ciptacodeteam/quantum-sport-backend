import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { withBranchContext } from '@/lib/branch-context'
const url = process.env.TEST_COACHING_DATABASE_URL
const gateway = vi.hoisted(() => vi.fn())
vi.mock('./midtrans.service', async (original) => ({
  ...(await original<typeof import('./midtrans.service')>()),
  midtransService: { initiateCheckoutPayment: gateway },
}))
const run = url ? describe : describe.skip
run('admin coaching transactional integration', () => {
  const raw = new PrismaClient({ datasourceUrl: url })
  const prefix = `coaching-${Date.now()}`
  const branch = prefix,
    user = `${prefix}-user`,
    admin = `${prefix}-admin`
  let service: typeof import('./coaching.service')
  let reconciliation: typeof import('./payment-reconcile.service')
  let cancellation: typeof import('./booking-cancel.service')
  const now = new Date('2026-11-01T12:00:00+07:00')
  const wall = (h: number, m = '00') =>
    new Date(`2026-11-02T${h}:00:00Z`.replace(':00:00', `:${m}:00`))
  const context = <T>(fn: () => T, branchId: string = branch) =>
    withBranchContext({ branchId, isAdmin: true, isSuperAdmin: false }, fn)
  const profile = async (
    id: string,
    role: 'COACH' | 'BALLBOY' = 'COACH',
    coachType: 'PADEL' | 'TENNIS' | 'PADEL_TENNIS' | null = 'PADEL',
  ) => {
    const person = await raw.staff.create({
      data: {
        id: `${prefix}-${id}`,
        branchId: branch,
        name: id,
        role,
        coachType: role === 'BALLBOY' ? null : coachType,
        adminServiceOnly: true,
        email: `${prefix}-${id}@test.invalid`,
        password: 'unused',
      },
    })
    return person.id
  }
  const staffSlot = async (
    staffId: string,
    hour = 13,
    minute = '00',
    price = 150000,
    type: 'COACH' | 'BALLBOY' = 'COACH',
  ) =>
    raw.slot.create({
      data: {
        branchId: branch,
        staffId,
        type,
        startAt: wall(hour, minute),
        endAt: wall(hour + 1, minute),
        price,
      },
    })
  const courtBooking = async (
    name: string,
    sport: 'PADEL' | 'TENNIS' = 'PADEL',
    hour = 13,
  ) => {
    const court = await raw.court.create({
      data: { branchId: branch, name, sport },
    })
    const slot = await raw.slot.create({
      data: {
        branchId: branch,
        courtId: court.id,
        type: 'COURT',
        startAt: wall(hour),
        endAt: wall(hour + 2),
        price: 100000,
        isAvailable: false,
      },
    })
    const booking = await raw.booking.create({
      data: {
        branchId: branch,
        userId: user,
        cashierId: admin,
        status: 'CONFIRMED',
        totalPrice: 100000,
      },
    })
    const detail = await raw.bookingDetail.create({
      data: {
        bookingId: booking.id,
        courtId: court.id,
        slotId: slot.id,
        price: 100000,
      },
    })
    const invoice = await raw.invoice.create({
      data: {
        branchId: branch,
        bookingId: booking.id,
        userId: user,
        number: `${prefix}-${name}`,
        total: 100000,
        subtotal: 100000,
        status: 'PAID',
        dueDate: now,
      },
    })
    return { detail, slot, booking, invoice }
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = url!
    service = await import('./coaching.service')
    reconciliation = await import('./payment-reconcile.service')
    cancellation = await import('./booking-cancel.service')
    await raw.branch.create({
      data: { id: branch, name: branch, address: 'isolated test' },
    })
    await raw.user.create({
      data: { id: user, name: 'Customer', phone: `+62${Date.now()}` },
    })
    await raw.staff.create({
      data: {
        id: admin,
        branchId: branch,
        name: 'Admin',
        email: `${admin}@test.invalid`,
        password: 'unused',
        role: 'ADMIN',
      },
    })
    await raw.bookingCoachType.upsert({
      where: { name: 'Coaching' },
      create: { name: 'Coaching' },
      update: {},
    })
    await raw.paymentMethod.create({
      data: {
        id: `${prefix}-method`,
        name: `${prefix}-VA`,
        channel: 'BCA_VIRTUAL_ACCOUNT',
        fees: 4000,
        percentage: 1,
      },
    })
    gateway.mockImplementation(async (input) => ({
      mode: 'snap',
      orderId: input.orderId,
      meta: {
        gateway: 'midtrans',
        checkout_mode: 'snap',
        snap_token: 'test-token',
        redirect_url: 'https://test.invalid/snap',
      },
    }))
  })
  afterAll(async () => {
    const bookings = await raw.booking.findMany({
      where: { branchId: branch },
      select: { id: true },
    })
    const ids = bookings.map((b) => b.id)
    const invoices = await raw.invoice.findMany({
      where: { bookingId: { in: ids } },
      select: { paymentId: true },
    })
    await raw.invoice.deleteMany({ where: { bookingId: { in: ids } } })
    await raw.payment.deleteMany({
      where: {
        id: { in: invoices.flatMap((i) => (i.paymentId ? [i.paymentId] : [])) },
      },
    })
    await raw.bookingCoach.deleteMany({ where: { bookingId: { in: ids } } })
    await raw.bookingBallboy.deleteMany({ where: { bookingId: { in: ids } } })
    await raw.bookingDetail.deleteMany({ where: { bookingId: { in: ids } } })
    await raw.booking.deleteMany({ where: { id: { in: ids } } })
    await raw.slot.deleteMany({ where: { branchId: branch } })
    await raw.court.deleteMany({ where: { branchId: branch } })
    await raw.staff.deleteMany({ where: { branchId: branch } })
    await raw.user.deleteMany({ where: { id: user } })
    await raw.branch.deleteMany({ where: { id: branch } })
    await raw.paymentMethod.deleteMany({ where: { id: `${prefix}-method` } })
    await raw.$disconnect()
  })
  it('exposes profiles only to admin and prevents cashier catalog writes', async () => {
    const app = (await import('@/app')).default
    const { generateJwtToken } = await import('@/lib/token')
    const token = await generateJwtToken({
      id: admin,
      role: 'ADMIN',
      email: `${admin}@test.invalid`,
    })
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Branch-ID': branch,
    }
    const created = await app.request('/admin/coaching', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Private Coach',
        kind: 'COACH',
        coachType: 'PADEL',
      }),
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { data: { id: string } }
    expect(
      await raw.staff.findUnique({ where: { id: body.data.id } }),
    ).toMatchObject({ adminServiceOnly: true })
    const publicList = await app.request('/coaches', {
      headers: { 'X-Branch-ID': branch },
    })
    expect(publicList.status).toBe(200)
    expect(
      ((await publicList.json()) as { data: { id: string }[] }).data.some(
        (p) => p.id === body.data.id,
      ),
    ).toBe(false)
    const unauthenticated = await app.request('/admin/coaching')
    expect(unauthenticated.status).toBe(401)
    const cashier = await raw.staff.create({
      data: {
        branchId: branch,
        name: 'Cashier',
        email: `${prefix}-cashier@test.invalid`,
        role: 'CASHIER',
        password: 'unused',
      },
    })
    const cashierToken = await generateJwtToken({
      id: cashier.id,
      role: 'CASHIER',
      email: cashier.email,
    })
    const forbidden = await app.request('/admin/coaching', {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${cashierToken}` },
      body: JSON.stringify({
        name: 'Invalid',
        kind: 'COACH',
        coachType: 'PADEL',
      }),
    })
    expect(forbidden.status).toBe(403)
    const list = await app.request('/admin/coaching/bookings?kind=COACH', {
      headers: { ...headers, Authorization: `Bearer ${cashierToken}` },
    })
    expect(list.status).toBe(200)
  }, 20000)
  it('creates an independent unpaid Snap invoice and confirms without changing the court invoice', async () => {
    const staff = await profile('paid-coach'),
      slot = await staffSlot(staff),
      court = await courtBooking('paid')
    const result = await context(() =>
      service.attachCoachingService(
        court.detail.id,
        slot.id,
        admin,
        `${prefix}-method`,
        now,
      ),
    )
    const invoice = await raw.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { payment: true, booking: { include: { coaches: true } } },
    })
    expect(invoice.status).toBe('PENDING')
    expect(invoice.total).toBe(156105)
    expect(invoice.booking?.status).toBe('HOLD')
    expect(invoice.booking?.serviceForBookingId).toBe(court.booking.id)
    expect(invoice.booking?.coaches[0].courtSlotId).toBe(court.slot.id)
    expect(invoice.dueDate?.getTime()).toBe(now.getTime() + 600000)
    const { generateJwtToken } = await import('@/lib/token')
    const token = await generateJwtToken({
      id: admin,
      role: 'ADMIN',
      email: `${admin}@test.invalid`,
    })
    const app = (await import('@/app')).default
    const response = await app.request(
      '/admin/bookings/schedule?courtSport=PADEL',
      { headers: { Authorization: `Bearer ${token}`, 'X-Branch-ID': branch } },
    )
    expect(response.status).toBe(200)
    const responseBody = (await response.json()) as {
      data: {
        id: string
        serviceForBookingId: string
        coaches: { courtSlotId: string; slot: { startAt: string } }[]
      }[]
    }
    const scheduled = responseBody.data.find((b) => b.id === result.bookingId)
    expect(scheduled?.serviceForBookingId).toBe(court.booking.id)
    expect(scheduled?.coaches[0].courtSlotId).toBe(court.slot.id)
    expect(scheduled?.coaches[0].slot.startAt).toBe('2026-11-02 13:00:00')
    expect(invoice.payment?.meta).toMatchObject({
      checkout_mode: 'snap',
      snap_token: 'test-token',
    })
    expect(
      await raw.invoice.findUnique({ where: { id: court.invoice.id } }),
    ).toMatchObject({ total: 100000, status: 'PAID' })
    await raw.$transaction((tx) =>
      reconciliation.finalizeSuccessfulPayment(tx, {
        invoiceId: result.invoiceId,
        paidAt: now,
      }),
    )
    expect(
      await raw.booking.findUnique({ where: { id: result.bookingId } }),
    ).toMatchObject({ status: 'CONFIRMED' })
    expect(
      await raw.bookingCoach.findFirst({
        where: { bookingId: result.bookingId },
      }),
    ).toMatchObject({ status: 'CONFIRMED' })
  })
  it('permits only one of simultaneous overlapping bookings, even with different slot IDs', async () => {
    const staff = await profile('race'),
      s1 = await staffSlot(staff),
      s2 = await staffSlot(staff, 13, '30')
    const a = await courtBooking('race-a'),
      b = await courtBooking('race-b')
    const attempts = await Promise.allSettled(
      [s1, s2].map((s, i) =>
        context(() =>
          service.attachCoachingService(
            [a, b][i].detail.id,
            s.id,
            admin,
            `${prefix}-method`,
            now,
          ),
        ),
      ),
    )
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1)
    expect(
      await raw.bookingCoach.count({ where: { slot: { staffId: staff } } }),
    ).toBe(1)
  })
  it('releases an expired hold and rejects late revival if that person has been booked again', async () => {
    const staff = await profile('expiry'),
      s1 = await staffSlot(staff),
      s2 = await staffSlot(staff, 13, '30')
    const a = await courtBooking('expiry-a'),
      b = await courtBooking('expiry-b')
    const first = await context(() =>
      service.attachCoachingService(
        a.detail.id,
        s1.id,
        admin,
        `${prefix}-method`,
        now,
      ),
    )
    await raw.$transaction(async (tx) => {
      await reconciliation.applyPaymentTerminalFailure(tx, {
        invoiceId: first.invoiceId,
        status: 'EXPIRED',
        reason: 'test expiry',
        now,
      })
      await cancellation.cancelHoldBookingAndReleaseResources(tx, {
        bookingId: first.bookingId,
        reason: 'test expiry',
        now,
      })
    })
    expect(await raw.slot.findUnique({ where: { id: s1.id } })).toMatchObject({
      isAvailable: true,
    })
    await context(() =>
      service.attachCoachingService(
        b.detail.id,
        s2.id,
        admin,
        `${prefix}-method`,
        now,
      ),
    )
    const late = await raw.$transaction((tx) =>
      reconciliation.finalizeSuccessfulPayment(tx, {
        invoiceId: first.invoiceId,
        paidAt: now,
      }),
    )
    expect(late.outcome).toBe('paid_needs_manual_review')
    expect(
      await raw.booking.findUnique({ where: { id: first.bookingId } }),
    ).toMatchObject({ status: 'CANCELLED' })
  })
  it('matches sports, requires a confirmed court and scopes access to its branch', async () => {
    const staff = await profile('sport'),
      slot = await staffSlot(staff),
      court = await courtBooking('tennis', 'TENNIS')
    await expect(
      context(() =>
        service.attachCoachingService(
          court.detail.id,
          slot.id,
          admin,
          undefined,
          now,
        ),
      ),
    ).rejects.toThrow('sesuai')
    await expect(
      context(
        () => service.coachingSchedule(staff, '2026-11-01', '2026-11-02'),
        'another-branch',
      ),
    ).rejects.toThrow('tidak ditemukan')
    await raw.booking.update({
      where: { id: court.booking.id },
      data: { status: 'CANCELLED' },
    })
    await expect(
      context(() =>
        service.attachCoachingService(
          court.detail.id,
          slot.id,
          admin,
          undefined,
          now,
        ),
      ),
    ).rejects.toThrow('terkonfirmasi')
  })
  it('only permits one ballboy on a tennis court and makes a zero-price invoice without gateway calls', async () => {
    const staff = await profile('ballboy', 'BALLBOY'),
      slot = await staffSlot(staff, 13, '00', 0, 'BALLBOY')
    const other = await profile('ballboy2', 'BALLBOY'),
      second = await staffSlot(other, 13, '00', 0, 'BALLBOY')
    const court = await courtBooking('ballboy', 'TENNIS'),
      padel = await courtBooking('ballboy-padel')
    await expect(
      context(() =>
        service.attachCoachingService(
          padel.detail.id,
          slot.id,
          admin,
          undefined,
          now,
        ),
      ),
    ).rejects.toThrow('tennis')
    const count = gateway.mock.calls.length
    const result = await context(() =>
      service.attachCoachingService(
        court.detail.id,
        slot.id,
        admin,
        undefined,
        now,
      ),
    )
    expect(result.status).toBe('PAID')
    expect(result.total).toBe(0)
    expect(gateway.mock.calls).toHaveLength(count)
    await expect(
      context(() =>
        service.attachCoachingService(
          court.detail.id,
          second.id,
          admin,
          undefined,
          now,
        ),
      ),
    ).rejects.toThrow('sudah ditambahkan')
  })
  it('rolls back the claim and all billing records when invoice initialization fails', async () => {
    const staff = await profile('gateway-failure'),
      slot = await staffSlot(staff),
      court = await courtBooking('gateway-failure')
    gateway.mockRejectedValueOnce(new Error('gateway unavailable'))
    await expect(
      context(() =>
        service.attachCoachingService(
          court.detail.id,
          slot.id,
          admin,
          `${prefix}-method`,
          now,
        ),
      ),
    ).rejects.toThrow('gateway unavailable')
    expect(await raw.slot.findUnique({ where: { id: slot.id } })).toMatchObject(
      { isAvailable: true },
    )
    expect(await raw.bookingCoach.count({ where: { slotId: slot.id } })).toBe(0)
  })
  it('generates idempotent WIB schedules and does not overwrite a booked slot', async () => {
    const staff = await profile('schedule')
    const input = {
      fromDate: '2026-11-02',
      toDate: '2026-11-02',
      days: [1],
      startHour: 13,
      endHour: 15,
      price: 200000,
    }
    expect(
      await context(() => service.saveCoachingSchedule(staff, input, now)),
    ).toEqual({ created: 2, updated: 0, skipped: 0 })
    const slots = await context(() =>
      service.coachingSchedule(staff, '2026-11-02', '2026-11-02'),
    )
    expect(slots[0].startAt).toBe('2026-11-02 13:00:00')
    const court = await courtBooking('schedule')
    await context(() =>
      service.attachCoachingService(
        court.detail.id,
        slots[0].id,
        admin,
        `${prefix}-method`,
        now,
      ),
    )
    expect(
      await context(() =>
        service.saveCoachingSchedule(staff, { ...input, price: 300000 }, now),
      ),
    ).toEqual({ created: 0, updated: 1, skipped: 1 })
    expect(
      await raw.slot.findUnique({ where: { id: slots[0].id } }),
    ).toMatchObject({ price: 200000 })
    const availability = await context(() =>
      service.coachingAvailability(
        court.detail.id,
        '2026-11-02 13:00:00',
        '2026-11-02 14:00:00',
        now,
      ),
    )
    expect(availability.some((s) => s.staffId === staff)).toBe(false)
  })
  it('books coach and ballboy atomically in one EDC invoice with a cashier audit trail', async () => {
    const coach = await profile('combined-coach', 'COACH', 'TENNIS')
    const ballboy = await profile('combined-ballboy', 'BALLBOY')
    const coachSlot = await staffSlot(coach)
    const ballboySlot = await staffSlot(ballboy, 13, '00', 45000, 'BALLBOY')
    const court = await courtBooking('combined-manual', 'TENNIS')
    const calls = gateway.mock.calls.length
    const result = await context(() =>
      service.attachCoachingService(
        court.detail.id,
        [coachSlot.id, ballboySlot.id],
        admin,
        undefined,
        now,
        { method: 'EDC', received: true },
      ),
    )
    const invoice = await raw.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: {
        payment: true,
        booking: { include: { coaches: true, ballboys: true } },
      },
    })
    expect(invoice).toMatchObject({
      status: 'PAID',
      total: 195000,
      processingFee: 0,
    })
    expect(invoice.booking).toMatchObject({
      status: 'CONFIRMED',
      holdExpiresAt: null,
    })
    expect(invoice.booking?.coaches).toHaveLength(1)
    expect(invoice.booking?.ballboys).toHaveLength(1)
    expect(invoice.payment).toMatchObject({
      status: 'PAID',
      amount: 195000,
      meta: { receivedBy: admin, channel: 'EDC' },
    })
    expect(gateway.mock.calls).toHaveLength(calls)
  })
  it('rolls back the first slot claim if the second service is unavailable', async () => {
    const coach = await profile('rollback-coach', 'COACH', 'TENNIS')
    const ballboy = await profile('rollback-ballboy', 'BALLBOY')
    const coachSlot = await staffSlot(coach)
    const ballboySlot = await staffSlot(ballboy, 13, '00', 45000, 'BALLBOY')
    await raw.slot.update({
      where: { id: ballboySlot.id },
      data: { isAvailable: false },
    })
    const court = await courtBooking('combined-rollback', 'TENNIS')
    await expect(
      context(() =>
        service.attachCoachingService(
          court.detail.id,
          [coachSlot.id, ballboySlot.id],
          admin,
          undefined,
          now,
          { method: 'EDC', received: true },
        ),
      ),
    ).rejects.toThrow('tersedia')
    expect(
      await raw.slot.findUnique({ where: { id: coachSlot.id } }),
    ).toMatchObject({ isAvailable: true })
    expect(
      await raw.booking.count({
        where: { serviceForBookingId: court.booking.id },
      }),
    ).toBe(0)
  })
})
