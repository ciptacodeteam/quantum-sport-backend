import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { withBranchContext } from '@/lib/branch-context'

const url = process.env.TEST_COACHING_DATABASE_URL
const run = url ? describe : describe.skip
run('shared coaching group deletion', () => {
  const raw = new PrismaClient({ datasourceUrl: url })
  const prefix = `delete-group-${Date.now()}`
  const branches = [0, 1].map((i) => `${prefix}-branch-${i}`)
  const groupId = `${prefix}-group`
  const userId = `${prefix}-user`
  let remove: (typeof import('./coaching-group.service'))['deleteCoachingGroup']
  let typeId: string
  beforeAll(async () => {
    global.prisma = raw
    remove = (await import('./coaching-group.service')).deleteCoachingGroup
    typeId = (await raw.bookingCoachType.create({ data: { name: prefix } })).id
    await raw.user.create({ data: { id: userId, name: prefix, phone: prefix } })
    await raw.branch.createMany({
      data: branches.map((id) => ({ id, name: id, address: 'test' })),
    })
    await raw.coachingGroup.create({
      data: {
        id: groupId,
        name: prefix,
        sports: ['PADEL'],
        branches: { create: branches.map((branchId) => ({ branchId })) },
      },
    })
    for (const [index, branchId] of branches.entries()) {
      const staffId = `${prefix}-coach-${index}`
      await raw.staff.create({
        data: {
          id: staffId,
          branchId,
          name: staffId,
          role: 'COACH',
          email: `${staffId}@test.invalid`,
          password: 'unused',
          coachingGroups: { create: { groupId } },
        },
      })
      const slot = await raw.slot.create({
        data: {
          branchId,
          staffId,
          type: 'COACH',
          price: 150000,
          startAt: new Date('2040-01-02T10:00:00Z'),
          endAt: new Date('2040-01-02T11:00:00Z'),
        },
      })
      const booking = await raw.booking.create({
        data: { branchId, userId, totalPrice: 150000, status: 'CONFIRMED' },
      })
      await raw.bookingCoach.create({
        data: {
          bookingId: booking.id,
          slotId: slot.id,
          bookingCoachTypeId: typeId,
          price: 150000,
          coachingGroupId: groupId,
          coachingGroupName: index === 0 ? 'Original group name' : null,
        },
      })
      await raw.invoice.create({
        data: {
          branchId,
          userId,
          bookingId: booking.id,
          number: `${prefix}-${index}`,
          subtotal: 150000,
          total: 150000,
          status: 'PAID',
          dueDate: new Date(),
          paidAt: new Date(),
        },
      })
    }
  })
  afterAll(async () => {
    await raw.bookingCoach.deleteMany({
      where: { booking: { branchId: { in: branches } } },
    })
    await raw.invoice.deleteMany({ where: { branchId: { in: branches } } })
    await raw.booking.deleteMany({ where: { branchId: { in: branches } } })
    await raw.slot.deleteMany({ where: { branchId: { in: branches } } })
    await raw.coachingGroup.deleteMany({ where: { id: groupId } })
    await raw.staff.deleteMany({ where: { branchId: { in: branches } } })
    await raw.branch.deleteMany({ where: { id: { in: branches } } })
    await raw.user.deleteMany({ where: { id: userId } })
    await raw.bookingCoachType.deleteMany({ where: { name: prefix } })
    await raw.$disconnect()
    delete global.prisma
  })
  it('preserves paid booking snapshots in every branch and removes only group memberships', async () => {
    const invoices = await raw.invoice.findMany({
      where: { branchId: { in: branches } },
      orderBy: { id: 'asc' },
    })
    await withBranchContext(
      { branchId: branches[0], isAdmin: true, isSuperAdmin: true },
      () => remove(groupId),
    )
    expect(
      await raw.coachingGroup.findUnique({ where: { id: groupId } }),
    ).toBeNull()
    expect(await raw.coachingGroupCoach.count({ where: { groupId } })).toBe(0)
    expect(await raw.coachingGroupBranch.count({ where: { groupId } })).toBe(0)
    expect(
      await raw.staff.count({ where: { branchId: { in: branches } } }),
    ).toBe(2)
    const lines = await raw.bookingCoach.findMany({
      where: { booking: { branchId: { in: branches } } },
    })
    expect(lines).toHaveLength(2)
    expect(
      lines.every(
        (line) => line.coachingGroupId === null && line.price === 150000,
      ),
    ).toBe(true)
    expect(lines.map((line) => line.coachingGroupName).sort()).toEqual(
      ['Original group name', prefix].sort(),
    )
    expect(
      await raw.invoice.findMany({
        where: { branchId: { in: branches } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(invoices)
    await expect(
      withBranchContext(
        { branchId: branches[0], isAdmin: true, isSuperAdmin: true },
        () => remove(groupId),
      ),
    ).rejects.toThrow('Grup coaching tidak ditemukan.')
  })
})
