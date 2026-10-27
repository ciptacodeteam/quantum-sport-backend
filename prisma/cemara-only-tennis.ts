import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(process.env.NODE_ENV, 'development')
  assert(['db', 'localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/quantum_sport')
  const where = { sport: 'TENNIS' as const, branchId: { not: 'cemara' } }
  const courts = await db.court.findMany({
    where,
    select: { id: true, name: true, branchId: true, isActive: true },
  })
  const upcoming = await db.bookingDetail.count({
    where: {
      court: where,
      slot: { endAt: { gt: new Date() } },
      booking: { status: { not: 'CANCELLED' } },
    },
  })
  console.log(
    JSON.stringify({
      preview: !process.argv.includes('--apply'),
      courts,
      upcomingBookedSlots: upcoming,
      historyPreserved: true,
    }),
  )
  if (!process.argv.includes('--apply')) return
  const result = await db.court.updateMany({ where, data: { isActive: false } })
  console.log(
    JSON.stringify({
      inactiveTennisCourtsOutsideCemara: result.count,
      bookingRecordsUnchanged: true,
    }),
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
