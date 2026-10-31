import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { branchScopedClient } from './branch-scope'
import { withBranchContext } from './branch-context'

const url = process.env.TEST_BRANCH_DATABASE_URL
const run = url ? describe : describe.skip
run('branch isolation against PostgreSQL', () => {
  const raw = new PrismaClient({ datasourceUrl: url })
  const db = branchScopedClient(raw) as PrismaClient
  const prefix = `branch-test-${Date.now()}`
  const a = `${prefix}-a`,
    b = `${prefix}-b`,
    third = `${prefix}-third`
  const userId = `${prefix}-user`,
    membershipId = `${prefix}-membership`,
    walletId = `${prefix}-wallet`
  const asBranch = <T>(
    branchId: string | null,
    callback: () => T,
    isSuperAdmin = false,
  ) =>
    withBranchContext(
      { branchId, isAdmin: true, isSuperAdmin, staffId: `${prefix}-admin` },
      async () => await callback(),
    )
  const date = new Date('2035-10-23T08:00:00Z')
  beforeAll(async () => {
    await raw.branch.createMany({
      data: [a, b, third].map((id) => ({
        id,
        name: id,
        address: 'Test branch address',
      })),
    })
    await raw.user.create({
      data: {
        id: userId,
        name: 'Branch Test Customer',
        phone: `+62${Date.now()}`,
      },
    })
    for (const id of [a, b]) {
      await raw.court.create({
        data: { id: `${id}-court`, branchId: id, name: `${prefix} Court 1` },
      })
      await raw.booking.create({
        data: { id: `${id}-booking`, branchId: id, userId },
      })
      await raw.invoice.create({
        data: {
          id: `${id}-invoice`,
          branchId: id,
          userId,
          bookingId: `${id}-booking`,
          number: `${id}-INV`,
          subtotal: 100,
          total: 100,
          dueDate: date,
        },
      })
    }
    await raw.membership.create({
      data: {
        id: membershipId,
        name: membershipId,
        price: 100,
        sessions: 10,
        duration: 30,
        branches: { create: [a, b].map((branchId) => ({ branchId })) },
      },
    })
    await raw.membershipUser.create({
      data: {
        id: walletId,
        userId,
        membershipId,
        startDate: date,
        endDate: new Date('2035-11-23'),
        remainingSessions: 10,
        remainingDuration: 30,
      },
    })
    await raw.invoice.create({
      data: {
        id: `${prefix}-membership-sale`,
        branchId: a,
        userId,
        membershipUserId: walletId,
        number: `${prefix}-membership-sale`,
        subtotal: 100,
        total: 100,
        status: 'PAID',
        dueDate: date,
        paidAt: date,
      },
    })
  })
  afterAll(async () => {
    await raw.invoice.deleteMany({ where: { userId } })
    await raw.booking.deleteMany({ where: { userId } })
    await raw.membershipUser.deleteMany({ where: { userId } })
    await raw.membership.deleteMany({ where: { id: membershipId } })
    await raw.slot.deleteMany({ where: { branchId: { in: [a, b, third] } } })
    await raw.court.deleteMany({ where: { branchId: { in: [a, b, third] } } })
    await raw.staff.deleteMany({ where: { email: `${prefix}@test.invalid` } })
    await raw.user.deleteMany({ where: { id: userId } })
    await raw.branch.deleteMany({ where: { id: { in: [a, b, third] } } })
    await raw.$disconnect()
  })
  it('filters collections, unique lookups, updates and counts by the selected branch', async () => {
    await asBranch(a, async () => {
      expect(
        await db.court.findUnique({ where: { id: `${b}-court` } }),
      ).toBeNull()
      expect(await db.court.count()).toBe(1)
      await expect(
        db.court.update({
          where: { id: `${b}-court` },
          data: { name: 'Forbidden' },
        }),
      ).rejects.toThrow()
      const result = await db.court.updateMany({
        data: { description: 'Branch A only' },
      })
      expect(result.count).toBe(1)
    })
    expect(
      (await raw.court.findUniqueOrThrow({ where: { id: `${b}-court` } }))
        .description,
    ).toBeNull()
  })
  it('filters nested invoices, bookings and counts on a shared customer account', async () => {
    const user = await asBranch(b, () =>
      db.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          bookings: true,
          invoice: true,
          _count: { select: { bookings: true } },
        },
      }),
    )
    expect(user.bookings.map((booking) => booking.branchId)).toEqual([b])
    expect(user.invoice.map((invoice) => invoice.branchId)).toEqual([b])
    expect(user._count.bookings).toBe(1)
  })
  it('rejects foreign-branch IDs and branch reassignment, including relation connections', async () => {
    await asBranch(a, async () => {
      await expect(
        db.slot.create({
          data: {
            courtId: `${b}-court`,
            type: 'COURT',
            startAt: date,
            endAt: new Date(date.getTime() + 3600000),
          },
        }),
      ).rejects.toThrow('cabang')
      await expect(
        db.slot.create({
          data: {
            court: { connect: { id: `${b}-court` } },
            type: 'COURT',
            startAt: date,
            endAt: date,
          },
        }),
      ).rejects.toThrow('cabang')
      await expect(
        db.court.update({ where: { id: `${a}-court` }, data: { branchId: b } }),
      ).rejects.toThrow('cabang')
      await expect(
        db.user.update({
          where: { id: userId },
          data: { bookings: { connect: { id: `${b}-booking` } } },
        }),
      ).rejects.toThrow('cabang')
    })
  })
  it('persists branch ownership through a booking/invoice transaction', async () => {
    const invoice = await asBranch(b, () =>
      db.$transaction(async (tx) => {
        const booking = await tx.booking.create({ data: { userId } })
        return tx.invoice.create({
          data: {
            userId,
            bookingId: booking.id,
            number: `${prefix}-transaction`,
            subtotal: 0,
            total: 0,
            status: 'PAID',
            dueDate: date,
            paidAt: date,
          },
        })
      }),
    )
    expect(invoice.branchId).toBe(b)
  })
  it('shares the paid membership wallet across playing branches independent of legacy eligibility mappings', async () => {
    await asBranch(b, async () => {
      const eligible = await db.membershipUser.findFirst({
        where: { id: walletId, invoice: { status: 'PAID' } },
      })
      expect(eligible?.remainingSessions).toBe(10)
      await db.membershipUser.updateMany({
        where: { id: walletId, remainingSessions: { gte: 2 } },
        data: { remainingSessions: { decrement: 2 } },
      })
    })
    expect(
      (
        await asBranch(a, () =>
          db.membershipUser.findUnique({ where: { id: walletId } }),
        )
      )?.remainingSessions,
    ).toBe(8)
    expect(
      (
        await asBranch(third, () =>
          db.membershipUser.findUnique({ where: { id: walletId } }),
        )
      )?.remainingSessions,
    ).toBe(8)
  })
  it('reports membership sales only at the selling branch while keeping the wallet shared', async () => {
    for (const branchId of [a, b]) {
      const count = await withBranchContext(
        {
          branchId,
          isAdmin: true,
          isSuperAdmin: false,
          membershipMode: 'sales',
        },
        async () => await db.membershipUser.count({ where: { id: walletId } }),
      )
      expect(count).toBe(branchId === a ? 1 : 0)
    }
  })
  it('does not overspend a shared balance when both branches book concurrently', async () => {
    const results = await Promise.all(
      [a, b].map((branchId) =>
        asBranch(
          branchId,
          async () =>
            await db.membershipUser.updateMany({
              where: { id: walletId, remainingSessions: { gte: 5 } },
              data: { remainingSessions: { decrement: 5 } },
            }),
        ),
      ),
    )
    expect(results.reduce((sum, result) => sum + result.count, 0)).toBe(1)
    expect(
      (await raw.membershipUser.findUniqueOrThrow({ where: { id: walletId } }))
        .remainingSessions,
    ).toBe(3)
  })
  it('supports a checked create input and rejects a spoofed branch in bulk operations', async () => {
    const slot = await asBranch(b, () =>
      db.slot.create({
        data: {
          court: { connect: { id: `${b}-court` } },
          type: 'COURT',
          startAt: date,
          endAt: date,
        },
      }),
    )
    expect(slot.branchId).toBe(b)
    await expect(
      asBranch(a, () =>
        db.court.createMany({ data: [{ branchId: b, name: 'Spoofed' }] }),
      ),
    ).rejects.toThrow('cabang')
  })
  it('allows combined super-admin reads, requires a branch for operations, and prevents privilege escalation', async () => {
    expect(
      await asBranch(
        null,
        () =>
          db.court.count({
            where: { id: { in: [`${a}-court`, `${b}-court`] } },
          }),
        true,
      ),
    ).toBe(2)
    await expect(
      asBranch(
        null,
        () => db.court.create({ data: { name: 'No branch' } }),
        true,
      ),
    ).rejects.toThrow('cabang')
    await expect(
      asBranch(a, () =>
        db.staff.create({
          data: {
            name: 'Forbidden',
            email: `${prefix}@test.invalid`,
            password: 'unused',
            role: 'SUPER_ADMIN',
          },
        }),
      ),
    ).rejects.toThrow('super admin')
    await expect(
      asBranch(a, () =>
        db.membership.update({
          where: { id: membershipId },
          data: { sessions: 99 },
        }),
      ),
    ).rejects.toThrow('super admin')
  })
})
