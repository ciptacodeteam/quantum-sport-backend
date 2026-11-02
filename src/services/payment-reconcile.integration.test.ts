import { randomUUID } from 'node:crypto'
import { PrismaClient, type Inventory } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { finalizeSuccessfulPayment } from './payment-reconcile.service'

// Opt in only with a disposable test PostgreSQL database in DATABASE_URL.
const run =
  process.env.RUN_PAYMENT_RECONCILE_DB_TESTS === '1' ? describe : describe.skip

run('late payment resource recovery against PostgreSQL', () => {
  const db = new PrismaClient()
  const prefix = `reconcile-${randomUUID()}`
  let branchId: string,
    userId: string,
    courtId: string,
    methodId: string,
    membershipId: string
  let sequence = 0

  beforeAll(async () => {
    branchId = (
      await db.branch.create({ data: { name: prefix, address: 'Test' } })
    ).id
    userId = (await db.user.create({ data: { name: prefix, phone: prefix } }))
      .id
    courtId = (await db.court.create({ data: { name: prefix, branchId } })).id
    methodId = (await db.paymentMethod.create({ data: { name: prefix } })).id
    membershipId = (
      await db.membership.create({
        data: { name: prefix, price: 100, sessions: 5, duration: 30 },
      })
    ).id
  })

  afterAll(async () => {
    if (branchId) {
      await db.invoice.deleteMany({ where: { branchId } })
      if (methodId)
        await db.payment.deleteMany({ where: { paymentMethodId: methodId } })
      await db.booking.deleteMany({ where: { branchId } })
      await db.slot.deleteMany({ where: { branchId } })
      await db.inventory.deleteMany({ where: { branchId } })
      if (userId) await db.membershipUser.deleteMany({ where: { userId } })
      if (membershipId)
        await db.membership.delete({ where: { id: membershipId } })
      if (courtId) await db.court.delete({ where: { id: courtId } })
      if (userId) await db.user.delete({ where: { id: userId } })
      if (methodId) await db.paymentMethod.delete({ where: { id: methodId } })
      await db.branch.delete({ where: { id: branchId } })
    }
    await db.$disconnect()
  })

  async function fixture(quantities: number[], remainingSessions = 5) {
    const wallet = await db.membershipUser.create({
      data: {
        userId,
        membershipId,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400_000),
        remainingSessions,
        remainingDuration: 30,
      },
    })
    const booking = await db.booking.create({
      data: {
        branchId,
        userId,
        status: 'CANCELLED',
        cancellationReason: 'Payment expired',
        membershipUserId: wallet.id,
        membershipSessionsUsed: 2,
      },
    })
    const startAt = new Date(Date.UTC(2027, 0, 1 + sequence++))
    const slot = await db.slot.create({
      data: {
        branchId,
        courtId,
        type: 'COURT',
        startAt,
        endAt: new Date(+startAt + 3600_000),
        isAvailable: true,
      },
    })
    await db.bookingDetail.create({
      data: { bookingId: booking.id, courtId, slotId: slot.id, price: 100 },
    })
    const inventories: Inventory[] = []
    for (const quantity of quantities) {
      const inventory = await db.inventory.create({
        data: { branchId, name: randomUUID(), quantity },
      })
      await db.bookingInventory.create({
        data: {
          bookingId: booking.id,
          inventoryId: inventory.id,
          quantity: 1,
          returnedAt: new Date(),
        },
      })
      inventories.push(inventory)
    }
    const payment = await db.payment.create({
      data: { paymentMethodId: methodId, amount: 100, status: 'EXPIRED' },
    })
    const invoice = await db.invoice.create({
      data: {
        branchId,
        userId,
        bookingId: booking.id,
        paymentId: payment.id,
        number: randomUUID(),
        subtotal: 100,
        total: 100,
        dueDate: new Date(),
        status: 'EXPIRED',
      },
    })
    return { booking, slot, inventories, wallet, payment, invoice }
  }

  const finalize = (invoiceId: string) =>
    db.$transaction((tx) => finalizeSuccessfulPayment(tx, { invoiceId }))

  async function expectFailedRecovery(f: Awaited<ReturnType<typeof fixture>>) {
    expect(
      await db.booking.findUnique({ where: { id: f.booking.id } }),
    ).toMatchObject({ status: 'CANCELLED' })
    expect(
      await db.slot.findUnique({ where: { id: f.slot.id } }),
    ).toMatchObject({ isAvailable: true })
    for (const inventory of f.inventories)
      expect(
        await db.inventory.findUnique({ where: { id: inventory.id } }),
      ).toMatchObject({ quantity: inventory.quantity })
    expect(
      await db.bookingInventory.count({
        where: { bookingId: f.booking.id, returnedAt: null },
      }),
    ).toBe(0)
    expect(
      await db.membershipUser.findUnique({ where: { id: f.wallet.id } }),
    ).toMatchObject({ remainingSessions: f.wallet.remainingSessions })
    expect(
      await db.invoice.findUnique({ where: { id: f.invoice.id } }),
    ).toMatchObject({ status: 'PAID' })
    expect(
      await db.payment.findUnique({ where: { id: f.payment.id } }),
    ).toMatchObject({
      status: 'PAID',
      meta: { reconcile_status: 'NEEDS_MANUAL_REVIEW' },
    })
  }

  it('restores earlier inventory deductions and returned markers when another item has no stock', async () => {
    const f = await fixture([5, 0])
    expect(await finalize(f.invoice.id)).toMatchObject({
      outcome: 'paid_needs_manual_review',
    })
    await expectFailedRecovery(f)
  })

  it('restores all inventory deductions when the membership has insufficient sessions', async () => {
    const f = await fixture([5, 3], 1)
    expect(await finalize(f.invoice.id)).toMatchObject({
      outcome: 'paid_needs_manual_review',
    })
    await expectFailedRecovery(f)
  })

  it('commits inventory and membership deductions exactly once for a successful recovery', async () => {
    const f = await fixture([5, 3])
    expect(await finalize(f.invoice.id)).toEqual({
      outcome: 'confirmed',
      revived: true,
    })
    expect(
      await db.booking.findUnique({ where: { id: f.booking.id } }),
    ).toMatchObject({ status: 'CONFIRMED' })
    expect(
      await db.slot.findUnique({ where: { id: f.slot.id } }),
    ).toMatchObject({ isAvailable: false })
    expect(
      await db.bookingInventory.count({
        where: { bookingId: f.booking.id, returnedAt: null },
      }),
    ).toBe(2)
    expect(
      await db.membershipUser.findUnique({ where: { id: f.wallet.id } }),
    ).toMatchObject({ remainingSessions: 3 })
    for (const inventory of f.inventories)
      expect(
        await db.inventory.findUnique({ where: { id: inventory.id } }),
      ).toMatchObject({ quantity: inventory.quantity - 1 })
    expect(await finalize(f.invoice.id)).toEqual({ outcome: 'already_paid' })
    expect(
      await db.membershipUser.findUnique({ where: { id: f.wallet.id } }),
    ).toMatchObject({ remainingSessions: 3 })
    for (const inventory of f.inventories)
      expect(
        await db.inventory.findUnique({ where: { id: inventory.id } }),
      ).toMatchObject({ quantity: inventory.quantity - 1 })
  })

  it('releases a partial court claim without freeing the unavailable slot', async () => {
    const f = await fixture([5])
    const startAt = new Date(+f.slot.startAt + 3600_000)
    const occupied = await db.slot.create({
      data: {
        branchId,
        courtId,
        type: 'COURT',
        startAt,
        endAt: new Date(+startAt + 3600_000),
        isAvailable: false,
      },
    })
    await db.bookingDetail.create({
      data: {
        bookingId: f.booking.id,
        courtId,
        slotId: occupied.id,
        price: 100,
      },
    })
    expect(await finalize(f.invoice.id)).toMatchObject({
      outcome: 'paid_needs_manual_review',
    })
    await expectFailedRecovery(f)
    expect(
      await db.slot.findUnique({ where: { id: occupied.id } }),
    ).toMatchObject({ isAvailable: false })
  })

  it('does not oversell shared inventory when two cancelled bookings recover concurrently', async () => {
    const a = await fixture([1]),
      b = await fixture([])
    await db.bookingInventory.create({
      data: {
        bookingId: b.booking.id,
        inventoryId: a.inventories[0].id,
        quantity: 1,
        returnedAt: new Date(),
      },
    })
    const results = await Promise.all([
      finalize(a.invoice.id),
      finalize(b.invoice.id),
    ])
    expect(
      results.filter((result) => result.outcome === 'confirmed'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.outcome === 'paid_needs_manual_review'),
    ).toHaveLength(1)
    expect(
      await db.inventory.findUnique({ where: { id: a.inventories[0].id } }),
    ).toMatchObject({ quantity: 0 })
    expect(
      await db.bookingInventory.count({
        where: { inventoryId: a.inventories[0].id, returnedAt: null },
      }),
    ).toBe(1)
  })

  it('restores the losing booking inventory when concurrent recoveries share limited membership sessions', async () => {
    const a = await fixture([5], 2),
      b = await fixture([5])
    await db.booking.update({
      where: { id: b.booking.id },
      data: { membershipUserId: a.wallet.id },
    })
    const results = await Promise.all([
      finalize(a.invoice.id),
      finalize(b.invoice.id),
    ])
    expect(
      results.filter((result) => result.outcome === 'confirmed'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.outcome === 'paid_needs_manual_review'),
    ).toHaveLength(1)
    expect(
      await db.membershipUser.findUnique({ where: { id: a.wallet.id } }),
    ).toMatchObject({ remainingSessions: 0 })
    for (const [index, f] of [a, b].entries()) {
      const recovered = results[index].outcome === 'confirmed'
      expect(
        await db.inventory.findUnique({ where: { id: f.inventories[0].id } }),
      ).toMatchObject({ quantity: recovered ? 4 : 5 })
      expect(
        await db.bookingInventory.count({
          where: { bookingId: f.booking.id, returnedAt: null },
        }),
      ).toBe(recovered ? 1 : 0)
      expect(
        await db.slot.findUnique({ where: { id: f.slot.id } }),
      ).toMatchObject({ isAvailable: !recovered })
    }
  })
})
