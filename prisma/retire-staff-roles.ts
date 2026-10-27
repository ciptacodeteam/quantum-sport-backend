import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
async function main() {
  const target = new URL(process.env.DATABASE_URL || '')
  assert.equal(process.env.NODE_ENV, 'development')
  assert(['db', 'localhost', '127.0.0.1'].includes(target.hostname))
  assert.equal(target.pathname, '/quantum_sport')
  const where = {
    role: { in: ['COACH', 'BALLBOY'] as ('COACH' | 'BALLBOY')[] },
    isActive: true,
  }
  const count = await db.staff.count({ where })
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ preview: true, accountsToDeactivate: count }))
    return
  }
  const result = await db.staff.updateMany({ where, data: { isActive: false } })
  assert.equal(await db.staff.count({ where }), 0)
  console.log(
    JSON.stringify({
      deactivated: result.count,
      activeRetiredRoles: 0,
      historyPreserved: true,
    }),
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
