import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/prisma'
import { withBranchContext } from '@/lib/branch-context'
import { getServiceIncome } from './service-income.service'

const run =
  process.env.RUN_SERVICE_INCOME_DB_TESTS === '1' ? describe : describe.skip
run('coach and ballboy income in PostgreSQL', () => {
  const prefix = `service-income-test-${Date.now()}`
  const branchId = `${prefix}-branch`,
    otherBranch = `${prefix}-other`,
    userId = `${prefix}-user`,
    groupId = `${prefix}-group`
  const coachId = `${prefix}-coach`,
    ballboyId = `${prefix}-ballboy`,
    bookingId = `${prefix}-booking`,
    invoiceId = `${prefix}-invoice`
  const startDate = new Date('2026-11-05T17:00:00Z'),
    endDate = new Date('2026-11-06T16:59:59.999Z')
  const asBranch = <T>(callback: () => T, id = branchId) =>
    withBranchContext(
      { branchId: id, isAdmin: true, isSuperAdmin: true },
      callback,
    )
  beforeAll(async () => {
    await db.branch.createMany({
      data: [branchId, otherBranch].map((id) => ({
        id,
        name: id,
        address: 'Test only',
      })),
    })
    await db.user.create({ data: { id: userId, name: prefix, phone: prefix } })
    await db.staff.createMany({
      data: [
        { id: coachId, role: 'COACH' },
        { id: ballboyId, role: 'BALLBOY' },
      ].map((staff) => ({
        ...staff,
        role: staff.role as 'COACH' | 'BALLBOY',
        branchId,
        name: staff.id,
        email: `${staff.id}@example.invalid`,
        password: 'test-only',
      })),
    })
    await db.coachingGroup.create({
      data: { id: groupId, name: prefix, sports: ['PADEL'] },
    })
    await db.bookingCoachType.upsert({
      where: { name: prefix },
      create: { id: `${prefix}-type`, name: prefix },
      update: {},
    })
    await db.slot.createMany({
      data: [
        { id: `${prefix}-coach-slot`, staffId: coachId, type: 'COACH' },
        { id: `${prefix}-ballboy-slot`, staffId: ballboyId, type: 'BALLBOY' },
      ].map((slot) => ({
        ...slot,
        type: slot.type as 'COACH' | 'BALLBOY',
        branchId,
        startAt: new Date('2026-12-01T12:00:00Z'),
        endAt: new Date('2026-12-01T13:00:00Z'),
        isAvailable: false,
      })),
    })
    await db.booking.create({
      data: {
        id: bookingId,
        branchId,
        userId,
        status: 'CONFIRMED',
        totalPrice: 360000,
        promoDiscountAmount: 40000,
        coaches: {
          create: {
            slotId: `${prefix}-coach-slot`,
            bookingCoachTypeId: `${prefix}-type`,
            coachingGroupId: groupId,
            coachingGroupName: 'Recorded Club',
            price: 150000,
          },
        },
        ballboys: {
          create: { slotId: `${prefix}-ballboy-slot`, price: 50000 },
        },
        invoice: {
          create: {
            id: invoiceId,
            branchId,
            userId,
            number: prefix,
            status: 'PAID',
            paidAt: new Date('2026-11-05T17:30:00Z'),
            dueDate: endDate,
            subtotal: 360000,
            total: 365000,
            processingFee: 5000,
          },
        },
      },
    })
  })
  afterAll(async () => {
    await db.invoice.deleteMany({ where: { id: invoiceId } })
    await db.booking.deleteMany({ where: { id: bookingId } })
    await db.slot.deleteMany({ where: { id: { startsWith: prefix } } })
    await db.bookingCoachType.deleteMany({ where: { id: `${prefix}-type` } })
    await db.coachingGroup.deleteMany({ where: { id: groupId } })
    await db.staff.deleteMany({ where: { id: { in: [coachId, ballboyId] } } })
    await db.user.deleteMany({ where: { id: userId } })
    await db.branch.deleteMany({
      where: { id: { in: [branchId, otherBranch] } },
    })
  })
  it('uses paid date, snapshots and net service amounts for a future session', async () => {
    const report = await asBranch(() => getServiceIncome(startDate, endDate))
    expect(report.summary).toMatchObject({
      totalAmount: 180000,
      coachAmount: 135000,
      ballboyAmount: 45000,
      unassignedAmount: 45000,
      invoiceCount: 1,
    })
    expect(report.clubs.find((club) => club.id === groupId)?.name).toBe(
      'Recorded Club',
    )
    expect(
      report.rows.every((row) => row.startAt === '2026-12-01 12:00:00'),
    ).toBe(true)
    const filtered = await asBranch(() =>
      getServiceIncome(startDate, endDate, {
        staffId: coachId,
        clubId: groupId,
        service: 'COACH',
      }),
    )
    expect(filtered.summary.totalAmount).toBe(135000)
  })
  it('does not disclose income from a different branch or a different payment day', async () => {
    expect(
      (await asBranch(() => getServiceIncome(startDate, endDate), otherBranch))
        .rows,
    ).toEqual([])
    expect(
      (
        await asBranch(() =>
          getServiceIncome(
            new Date('2026-12-01T00:00:00Z'),
            new Date('2026-12-02T00:00:00Z'),
          ),
        )
      ).rows,
    ).toEqual([])
  })
  it('excludes a refunded invoice', async () => {
    await db.invoice.update({
      where: { id: invoiceId },
      data: { status: 'REFUNDED' },
    })
    expect(
      (await asBranch(() => getServiceIncome(startDate, endDate))).summary
        .totalAmount,
    ).toBe(0)
  })
})
