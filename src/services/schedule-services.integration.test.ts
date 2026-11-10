import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { withBranchContext } from '@/lib/branch-context'
const url = process.env.TEST_SCHEDULE_SERVICES_DATABASE_URL
const run = url ? describe : describe.skip
run('schedule detail services and rescheduling', () => {
  const raw = new PrismaClient({ datasourceUrl: url })
  const prefix = `schedule-services-${Date.now()}`
  const branchId = prefix,
    userId = `${prefix}-customer`,
    coachId = `${prefix}-coach`,
    ballboyId = `${prefix}-ballboy`,
    cashierId = `${prefix}-cashier`
  let attach: (typeof import('./coaching.service'))['attachCoachingService']
  let handler: (typeof import('@/handlers/admin/booked-court.handler'))['rescheduleCourtBookingHandler']
  let courtId: string,
    detailId: string,
    bookingId: string,
    methodId: string,
    onlineId: string
  let originalCourtSlot: string,
    coachSlot: string,
    ballboySlot: string,
    serviceInvoiceId: string,
    paymentId: string | null
  const now = new Date('2040-01-01T00:00:00Z')
  const context = <T>(fn: () => T) =>
    withBranchContext({ branchId, isAdmin: true, isSuperAdmin: false }, fn)
  const slot = async (day: number, type: 'COURT' | 'COACH' | 'BALLBOY') =>
    raw.slot.create({
      data: {
        branchId,
        type,
        ...(type === 'COURT'
          ? { courtId }
          : { staffId: type === 'COACH' ? coachId : ballboyId }),
        startAt: new Date(`2040-01-${String(day).padStart(2, '0')}T10:00:00Z`),
        endAt: new Date(`2040-01-${String(day).padStart(2, '0')}T11:00:00Z`),
        price: type === 'COURT' ? 300000 : type === 'COACH' ? 150000 : 45000,
      },
    })
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    global.prisma = raw
    attach = (await import('./coaching.service')).attachCoachingService
    handler = (await import('@/handlers/admin/booked-court.handler'))
      .rescheduleCourtBookingHandler
    await raw.branch.create({
      data: { id: branchId, name: prefix, address: 'test' },
    })
    await raw.user.create({ data: { id: userId, name: 'Budi', phone: prefix } })
    for (const [id, role] of [
      [coachId, 'COACH'],
      [ballboyId, 'BALLBOY'],
      [cashierId, 'CASHIER'],
    ] as const)
      await raw.staff.create({
        data: {
          id,
          branchId,
          role,
          coachType: 'PADEL',
          name: id,
          email: `${id}@test.invalid`,
          password: 'unused',
          adminServiceOnly: true,
        },
      })
    courtId = (
      await raw.court.create({
        data: { branchId, name: prefix, sport: 'PADEL' },
      })
    ).id
    methodId = (
      await raw.paymentMethod.create({
        data: {
          name: `${prefix}-Cash`,
          isOffline: true,
          fees: 5000,
          percentage: 2,
        },
      })
    ).id
    onlineId = (
      await raw.paymentMethod.create({
        data: { name: `${prefix}-VA`, channel: 'BCA_VIRTUAL_ACCOUNT' },
      })
    ).id
    await raw.bookingCoachType.upsert({
      where: { name: 'Coaching' },
      create: { name: 'Coaching' },
      update: {},
    })
    originalCourtSlot = (await slot(5, 'COURT')).id
    await raw.slot.update({
      where: { id: originalCourtSlot },
      data: { isAvailable: false },
    })
    coachSlot = (await slot(5, 'COACH')).id
    ballboySlot = (await slot(5, 'BALLBOY')).id
    bookingId = (
      await raw.booking.create({
        data: {
          branchId,
          userId,
          cashierId,
          status: 'CONFIRMED',
          totalPrice: 300000,
        },
      })
    ).id
    detailId = (
      await raw.bookingDetail.create({
        data: {
          bookingId,
          slotId: originalCourtSlot,
          courtId,
          price: 300000,
          discountPrice: 300000,
        },
      })
    ).id
    await raw.invoice.create({
      data: {
        branchId,
        userId,
        bookingId,
        number: `${prefix}-court`,
        subtotal: 300000,
        total: 300000,
        status: 'PAID',
        paidAt: now,
        dueDate: now,
      },
    })
  })
  afterAll(async () => {
    const invoices = await raw.invoice.findMany({
      where: { branchId },
      select: { paymentId: true },
    })
    await raw.bookingCoach.deleteMany({ where: { booking: { branchId } } })
    await raw.bookingBallboy.deleteMany({ where: { booking: { branchId } } })
    await raw.invoice.deleteMany({ where: { branchId } })
    await raw.payment.deleteMany({
      where: {
        id: { in: invoices.flatMap((i) => (i.paymentId ? [i.paymentId] : [])) },
      },
    })
    await raw.bookingDetail.deleteMany({ where: { booking: { branchId } } })
    await raw.booking.deleteMany({ where: { branchId } })
    await raw.slot.deleteMany({ where: { branchId } })
    await raw.court.deleteMany({ where: { branchId } })
    await raw.staff.deleteMany({ where: { branchId } })
    await raw.paymentMethod.deleteMany({
      where: { id: { in: [methodId, onlineId] } },
    })
    await raw.user.delete({ where: { id: userId } })
    await raw.branch.delete({ where: { id: branchId } })
    await raw.$disconnect()
    delete global.prisma
    vi.useRealTimers()
  })
  const reschedule = (newSlotId: string) =>
    context(() =>
      (handler.at(-1) as any)({
        get: () => ({ id: cashierId, role: 'CASHIER' }),
        req: {
          valid: (key: string) =>
            key === 'param' ? { id: detailId } : { newSlotId },
        },
        var: { logger: { fatal: vi.fn() } },
        json: (body: unknown) => body,
      }),
    )
  it('rejects absent or online payment methods, then records a real offline receipt for both services', async () => {
    await expect(
      context(() =>
        attach(detailId, [coachSlot, ballboySlot], cashierId, undefined, now),
      ),
    ).rejects.toThrow(/offline/)
    await expect(
      context(() =>
        attach(detailId, [coachSlot, ballboySlot], cashierId, onlineId, now),
      ),
    ).rejects.toThrow(/offline/)
    expect(
      await raw.slot.count({
        where: { id: { in: [coachSlot, ballboySlot] }, isAvailable: true },
      }),
    ).toBe(2)
    const result = await context(() =>
      attach(detailId, [coachSlot, ballboySlot], cashierId, methodId, now),
    )
    serviceInvoiceId = result.invoiceId
    const invoice = await raw.invoice.findUniqueOrThrow({
      where: { id: serviceInvoiceId },
      include: { payment: true },
    })
    paymentId = invoice.paymentId
    expect(invoice).toMatchObject({
      status: 'PAID',
      total: 195000,
      processingFee: 0,
    })
    expect(invoice.payment).toMatchObject({
      paymentMethodId: methodId,
      amount: 195000,
      fees: 0,
      status: 'PAID',
    })
  })
  it('moves court, separately invoiced coach and ballboy together while preserving the paid receipt', async () => {
    const [court, coach, ballboy] = await Promise.all([
      slot(6, 'COURT'),
      slot(6, 'COACH'),
      slot(6, 'BALLBOY'),
    ])
    await reschedule(court.id)
    expect(
      (await raw.bookingDetail.findUniqueOrThrow({ where: { id: detailId } }))
        .slotId,
    ).toBe(court.id)
    expect(
      await raw.bookingCoach.findFirstOrThrow({
        where: { booking: { invoice: { id: serviceInvoiceId } } },
      }),
    ).toMatchObject({ slotId: coach.id, courtSlotId: court.id, price: 150000 })
    expect(
      await raw.bookingBallboy.findFirstOrThrow({
        where: { booking: { invoice: { id: serviceInvoiceId } } },
      }),
    ).toMatchObject({ slotId: ballboy.id, courtSlotId: court.id, price: 45000 })
    expect(
      await raw.invoice.findUniqueOrThrow({ where: { id: serviceInvoiceId } }),
    ).toMatchObject({ total: 195000, paymentId })
    expect(
      await raw.slot.count({
        where: {
          id: { in: [originalCourtSlot, coachSlot, ballboySlot] },
          isAvailable: true,
        },
      }),
    ).toBe(3)
    expect(
      await raw.slot.count({
        where: {
          id: { in: [court.id, coach.id, ballboy.id] },
          isAvailable: false,
        },
      }),
    ).toBe(3)
  })
  it('rolls back the entire move when the ballboy has no replacement slot', async () => {
    const before = await raw.bookingDetail.findUniqueOrThrow({
      where: { id: detailId },
    })
    const [court, coach] = await Promise.all([
      slot(7, 'COURT'),
      slot(7, 'COACH'),
    ])
    await expect(reschedule(court.id)).rejects.toThrow(/Ballboy/)
    expect(
      (await raw.bookingDetail.findUniqueOrThrow({ where: { id: detailId } }))
        .slotId,
    ).toBe(before.slotId)
    expect(
      await raw.slot.count({
        where: { id: { in: [court.id, coach.id] }, isAvailable: true },
      }),
    ).toBe(2)
    expect(
      await raw.invoice.findUniqueOrThrow({ where: { id: serviceInvoiceId } }),
    ).toMatchObject({ total: 195000, paymentId })
  })
})
