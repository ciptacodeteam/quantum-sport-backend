import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { withBranchContext } from '@/lib/branch-context'
const url = process.env.TEST_INHOUSE_DATABASE_URL
const run = url ? describe : describe.skip
run('in-house coaching transactions', () => {
  const raw = new PrismaClient({ datasourceUrl: url })
  const prefix = `inhouse-${Date.now()}`
  const branch = prefix,
    userId = `${prefix}-customer`,
    staffId = `${prefix}-andi`
  let service: typeof import('./inhouse-coaching.service')
  let scoped: (typeof import('@/lib/prisma'))['db']
  let planId: string, paymentMethodId: string, courtId: string
  const context = <T>(fn: () => T, branchId = branch) =>
    withBranchContext({ branchId, isAdmin: true, isSuperAdmin: false }, fn)
  beforeAll(async () => {
    // Explicit test URL only: never use the application datasource for integration fixtures.
    global.prisma = raw
    service = await import('./inhouse-coaching.service')
    scoped = (await import('@/lib/prisma')).db
    await raw.branch.create({
      data: { id: branch, name: prefix, address: 'test' },
    })
    await raw.user.create({
      data: { id: userId, name: 'Customer', phone: `${Date.now()}` },
    })
    await raw.staff.create({
      data: {
        id: staffId,
        branchId: branch,
        name: 'Andi',
        email: `${prefix}@test.invalid`,
        password: 'unused',
        role: 'COACH',
        coachType: 'PADEL',
        adminServiceOnly: true,
      },
    })
    await raw.staff.create({
      data: {
        id: `${prefix}-cashier`,
        branchId: branch,
        name: 'Cashier',
        email: `${prefix}-cashier@test.invalid`,
        password: 'unused',
        role: 'CASHIER',
      },
    })
    const plan = await context(() =>
      service.saveInHousePlan(undefined, {
        staffId,
        name: 'Andi 1 jam',
        hours: 1,
        hourlyPrice: 1000000,
        courtHourlyShare: 250000,
        extraParticipantHourlyPrice: 100000,
        isActive: true,
      }),
    )
    planId = plan.id
    paymentMethodId = (
      await raw.paymentMethod.create({
        data: { name: `${prefix}-Cash`, isOffline: true },
      })
    ).id
    courtId = (
      await raw.court.create({
        data: { branchId: branch, name: 'Court A', sport: 'PADEL' },
      })
    ).id
  })
  afterAll(async () => {
    const bookings = await raw.booking.findMany({
      where: { branchId: branch },
      select: { id: true },
    })
    const payments = await raw.invoice.findMany({
      where: { branchId: branch },
      select: { paymentId: true },
    })
    await raw.inHouseUsage.deleteMany({ where: { branchId: branch } })
    await raw.bookingCoach.deleteMany({
      where: { bookingId: { in: bookings.map((b) => b.id) } },
    })
    await raw.invoice.deleteMany({ where: { branchId: branch } })
    await raw.payment.deleteMany({
      where: {
        id: { in: payments.flatMap((p) => (p.paymentId ? [p.paymentId] : [])) },
      },
    })
    await raw.inHouseWallet.deleteMany({ where: { branchId: branch } })
    await raw.inHousePlan.deleteMany({ where: { branchId: branch } })
    await raw.bookingDetail.deleteMany({
      where: { bookingId: { in: bookings.map((b) => b.id) } },
    })
    await raw.booking.deleteMany({ where: { branchId: branch } })
    await raw.slot.deleteMany({ where: { branchId: branch } })
    await raw.court.deleteMany({ where: { branchId: branch } })
    await raw.staff.deleteMany({ where: { branchId: branch } })
    await raw.user.delete({ where: { id: userId } })
    await raw.paymentMethod.delete({ where: { id: paymentMethodId } })
    await raw.branch.delete({ where: { id: branch } })
    await raw.$disconnect()
    delete global.prisma
  })
  const sale = (requestId: string) =>
    context(() =>
      service.sellInHousePlan(
        { packageId: planId, userId, paymentMethodId, requestId },
        'cashier',
      ),
    )
  const prepareHour = async (hour: number) => {
    const startAt = new Date(`2040-11-03T${hour}:00:00Z`),
      endAt = new Date(+startAt + 3600000)
    const court = await raw.slot.create({
      data: {
        branchId: branch,
        courtId,
        type: 'COURT',
        startAt,
        endAt,
        price: 300000,
        isAvailable: false,
      },
    })
    const coach = await raw.slot.create({
      data: {
        branchId: branch,
        staffId,
        type: 'COACH',
        startAt,
        endAt,
        price: 750000,
      },
    })
    return { court, coach }
  }
  const redeem = (
    walletId: string,
    slots: Awaited<ReturnType<typeof prepareHour>>,
  ) =>
    context(() =>
      scoped.$transaction(async (tx) => {
        const booking = await tx.booking.create({
          data: { userId, status: 'CONFIRMED' },
        })
        await tx.bookingDetail.create({
          data: {
            bookingId: booking.id,
            slotId: slots.court.id,
            courtId,
            price: 300000,
            discountPrice: 300000,
          },
        })
        return service.redeemInHouseSelections(tx, {
          selections: [
            {
              walletId,
              courtSlotId: slots.court.id,
              coachSlotId: slots.coach.id,
              participants: 3,
            },
          ],
          userId,
          bookingId: booking.id,
          courtSlotIds: [slots.court.id],
          clubCoachSlots: [],
        })
      }),
    )
  it('serializes concurrent sale retries into one paid invoice and one wallet', async () => {
    const [a, b] = await Promise.all([
      sale(`${prefix}-sale-retry`),
      sale(`${prefix}-sale-retry`),
    ])
    expect(a.id).toBe(b.id)
    expect(
      await raw.inHouseWallet.count({
        where: { saleRequestId: `${prefix}-sale-retry` },
      }),
    ).toBe(1)
    expect(
      await raw.invoice.count({
        where: { inHouseWalletId: a.id, status: 'PAID', total: 1000000 },
      }),
    ).toBe(1)
  })
  it('uses the last hour only once, rolls back the losing reservation, and restores cancellation exactly once', async () => {
    const wallet = await sale(`${prefix}-race`)
    const slots = await Promise.all([prepareHour(18), prepareHour(19)])
    const results = await Promise.allSettled(
      slots.map((slot) => redeem(wallet.id, slot)),
    )
    expect(
      results.filter((r) => r.status === 'fulfilled'),
      results
        .map((r) => (r.status === 'rejected' ? String(r.reason) : 'ok'))
        .join('\n'),
    ).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(
      (await raw.inHouseWallet.findUniqueOrThrow({ where: { id: wallet.id } }))
        .remainingMinutes,
    ).toBe(0)
    const usages = await raw.inHouseUsage.findMany({
      where: { walletId: wallet.id },
    })
    expect(usages).toHaveLength(1)
    expect(usages[0]).toMatchObject({
      courtAmount: 250000,
      coachAmount: 750000,
      extraAmount: 200000,
      participants: 3,
    })
    expect(
      await raw.slot.count({
        where: { id: { in: slots.map((s) => s.coach.id) }, isAvailable: true },
      }),
    ).toBe(1)
    const bookedCoach = await raw.bookingCoach.findUniqueOrThrow({
      where: { id: usages[0].bookingCoachId },
    })
    const { cancelCourtBookingServices } =
      await import('./court-service-cancellation.service')
    await Promise.all(
      [1, 2].map(() =>
        context(() =>
          scoped.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookedCoach.bookingId} FOR UPDATE`
            await tx.booking.update({
              where: { id: bookedCoach.bookingId },
              data: { status: 'CANCELLED' },
            })
            await cancelCourtBookingServices(
              tx,
              bookedCoach.bookingId,
              [bookedCoach.courtSlotId!],
              'Test cancellation',
            )
          }),
        ),
      ),
    )
    expect(
      (
        await raw.inHouseUsage.findUniqueOrThrow({
          where: { id: usages[0].id },
        })
      ).restoredAt,
    ).not.toBeNull()
    expect(
      (
        await raw.bookingCoach.findUniqueOrThrow({
          where: { id: bookedCoach.id },
        })
      ).status,
    ).toBe('CANCELLED')
    expect(
      (await raw.inHouseWallet.findUniqueOrThrow({ where: { id: wallet.id } }))
        .remainingMinutes,
    ).toBe(60)
  })
  it('keeps purchased prices after a catalog update and blocks another branch from using the wallet', async () => {
    const wallet = await sale(`${prefix}-snapshot`)
    await context(() =>
      service.saveInHousePlan(planId, {
        staffId,
        name: 'Harga baru',
        hours: 1,
        hourlyPrice: 1100000,
        courtHourlyShare: 300000,
        extraParticipantHourlyPrice: 100000,
        isActive: true,
      }),
    )
    const stored = await raw.inHouseWallet.findUniqueOrThrow({
      where: { id: wallet.id },
    })
    expect(stored).toMatchObject({
      hourlyPrice: 1000000,
      courtHourlyShare: 250000,
    })
    expect(
      await context(
        () => scoped.inHouseWallet.findFirst({ where: { id: wallet.id } }),
        'other-branch',
      ),
    ).toBeNull()
  })
  it.each([
    { hours: 1, participants: 1, hourlyPrice: 1000000, courtShare: 250000 },
    { hours: 2, participants: 1, hourlyPrice: 1000000, courtShare: 250000 },
    { hours: 2, participants: 3, hourlyPrice: 800000, courtShare: 200000 },
  ])(
    'checks out $hours direct hours with $participants participants using real database accounting',
    async ({ hours, participants, hourlyPrice, courtShare }) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2040-11-01T00:00:00Z'))
      try {
        await context(() =>
          service.saveInHousePlan(planId, {
            staffId,
            name: 'Tarif satuan',
            hours: 1,
            hourlyPrice,
            courtHourlyShare: courtShare,
            extraParticipantHourlyPrice: 100000,
            isActive: true,
          }),
        )
        const firstHour = hours === 1 ? 10 : participants === 1 ? 11 : 13
        const slots = await Promise.all(
          Array.from({ length: hours }, (_, index) =>
            prepareHour(firstHour + index),
          ),
        )
        await raw.slot.updateMany({
          where: { id: { in: slots.map((s) => s.court.id) } },
          data: { isAvailable: true },
        })
        const walletBefore = await raw.inHouseWallet.findMany({
          where: { branchId: branch },
          orderBy: { id: 'asc' },
        })
        const { adminCheckoutHandler } =
          await import('@/handlers/admin/checkout.handler')
        const total = hours * (hourlyPrice + (participants - 1) * 100000)
        const payload = {
          expectedTotal: total + 1,
          userId,
          totalHours: hours,
          courtSlots: slots.map((s) => s.court.id),
          useMembership: false,
          paymentMethodId,
          inHouseSelections: slots.map((s) => ({
            planId,
            courtSlotId: s.court.id,
            coachSlotId: s.coach.id,
            participants,
          })),
        }
        const checkout = () =>
          context(() =>
            (adminCheckoutHandler.at(-1) as any)({
              req: { valid: () => payload },
              get: () => ({ id: `${prefix}-cashier`, role: 'CASHIER' }),
              var: {
                logger: {
                  info: vi.fn(),
                  warn: vi.fn(),
                  fatal: vi.fn(),
                  error: vi.fn(),
                },
              },
              json: (body: any) => body,
            }),
          )
        const previousBookings = await raw.booking.count({
          where: { branchId: branch },
        })
        await expect(checkout()).rejects.toThrow(/Total pembayaran berubah/)
        expect(await raw.booking.count({ where: { branchId: branch } })).toBe(
          previousBookings,
        )
        expect(
          await raw.slot.count({
            where: {
              id: { in: slots.flatMap((s) => [s.court.id, s.coach.id]) },
              isAvailable: true,
            },
          }),
        ).toBe(hours * 2)
        payload.expectedTotal = total
        const result = await checkout()
        expect(result.success).toBe(true)
        const invoice = await raw.invoice.findUniqueOrThrow({
          where: { id: result.data.invoiceId },
          include: {
            payment: true,
            booking: { include: { coaches: true, details: true } },
          },
        })
        expect(invoice.total).toBe(total)
        expect(invoice.payment).toMatchObject({
          amount: total,
          paymentMethodId,
          status: 'PAID',
        })
        expect(invoice.booking).toMatchObject({
          totalPrice: total,
          courtDiscountPrice: courtShare * hours,
        })
        expect(
          invoice.booking!.coaches.reduce((sum, coach) => sum + coach.price, 0),
        ).toBe((hourlyPrice - courtShare + (participants - 1) * 100000) * hours)
        expect(
          invoice.booking!.details.reduce(
            (sum, court) => sum + court.discountPrice,
            0,
          ),
        ).toBe(courtShare * hours)
        expect(
          await raw.inHouseWallet.findMany({
            where: { branchId: branch },
            orderBy: { id: 'asc' },
          }),
        ).toEqual(walletBefore)
      } finally {
        vi.useRealTimers()
      }
    },
  )
})
