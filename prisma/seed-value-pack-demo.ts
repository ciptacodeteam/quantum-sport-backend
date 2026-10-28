import assert from 'node:assert/strict'
import { PrismaClient, PaymentStatus } from '@prisma/client'
import clubTime from '../src/lib/club-time'

const db = new PrismaClient()
const apply = process.argv.includes('--apply')

async function main() {
  const target = new URL(process.env.DATABASE_URL || '')
  assert.equal(process.env.NODE_ENV, 'development')
  assert(['db', 'localhost', '127.0.0.1'].includes(target.hostname))
  assert.equal(target.pathname, '/quantum_sport')
  const branches = await db.branch.findMany({ orderBy: { sequence: 'asc' } })
  const packages = await db.membership.findMany({
    where: { id: { startsWith: 'demo-membership-' } },
    orderBy: { id: 'asc' },
  })
  const users = await db.user.findMany({
    where: { id: { startsWith: 'demo-' } },
    orderBy: { id: 'asc' },
    take: 30,
  })
  const method = await db.paymentMethod.findFirstOrThrow({
    where: { channel: 'CASH' },
  })
  assert.equal(packages.length, 6, 'Expected the six local demo Value Packs')
  assert(users.length >= 12, 'Expected local demo customers')
  const states = [
    'active',
    'pending',
    'suspended',
    'expired',
    'exhausted',
    'cancelled',
  ] as const
  const rows = branches.flatMap((branch) =>
    ['PADEL', 'TENNIS'].flatMap((sport) =>
      states.map((state, index) => ({ branch, sport, state, index })),
    ),
  )
  const existing = await db.membershipUser.count({
    where: { id: { startsWith: 'demo-value-pack-' } },
  })
  console.log(
    JSON.stringify({
      apply,
      planned: rows.length,
      existing,
      branches: branches.map((b) => b.id),
      states,
    }),
  )
  if (!apply) return
  let created = 0
  await db.$transaction(async (tx) => {
    for (const [index, row] of rows.entries()) {
      const id = `demo-value-pack-${row.branch.id}-${row.sport.toLowerCase()}-${row.state}`
      if (await tx.membershipUser.findUnique({ where: { id } })) continue
      const pack = packages.filter((p) => p.sport === row.sport)[row.index % 3]
      const user = users[index % users.length]
      const start = clubTime()
        .startOf('day')
        .subtract(row.state === 'expired' ? 40 : 3, 'day')
      const end = start.add(pack.duration, 'day')
      const remaining =
        row.state === 'exhausted' ? 0 : pack.sessions - (row.index % 4)
      const paymentStatus =
        row.state === 'pending'
          ? PaymentStatus.PENDING
          : row.state === 'cancelled'
            ? PaymentStatus.CANCELLED
            : PaymentStatus.PAID
      const paidAt = paymentStatus === 'PAID' ? start.toDate() : null
      await tx.membershipUser.create({
        data: {
          id,
          userId: user.id,
          membershipId: pack.id,
          startDate: start.toDate(),
          endDate: end.toDate(),
          remainingSessions: remaining,
          remainingDuration: Math.max(
            0,
            end.diff(clubTime().startOf('day'), 'day'),
          ),
          isExpired: row.state === 'expired',
          isSuspended: row.state === 'suspended',
          suspensionReason:
            row.state === 'suspended'
              ? 'Contoh: pelanggan sedang di luar kota'
              : null,
          suspensionEndDate:
            row.state === 'suspended'
              ? clubTime().add(7, 'day').toDate()
              : null,
          createdAt: start.add(index, 'minute').toDate(),
        },
      })
      const payment = await tx.payment.create({
        data: {
          id: `${id}-payment`,
          paymentMethodId: method.id,
          status: paymentStatus,
          amount: pack.price,
          fees: 0,
          paidAt,
          cancelledAt: paymentStatus === 'CANCELLED' ? start.toDate() : null,
          dueDate: clubTime().add(2, 'day').toDate(),
          meta: { demo: true },
        },
      })
      await tx.invoice.create({
        data: {
          id: `${id}-invoice`,
          branchId: row.branch.id,
          membershipUserId: id,
          userId: user.id,
          paymentId: payment.id,
          number: `DEMO-VP-${row.branch.id.toUpperCase()}-${row.sport}-${row.index + 1}`,
          subtotal: pack.price,
          total: pack.price,
          status: paymentStatus,
          paidAt,
          issuedAt: start.toDate(),
          dueDate: clubTime().add(2, 'day').toDate(),
          cancelledAt: paymentStatus === 'CANCELLED' ? start.toDate() : null,
        },
      })
      created++
    }
    assert.equal(
      await tx.membershipUser.count({
        where: { id: { startsWith: 'demo-value-pack-' } },
      }),
      rows.length,
    )
  })
  console.log(JSON.stringify({ created, totalDemoTransactions: rows.length }))
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
