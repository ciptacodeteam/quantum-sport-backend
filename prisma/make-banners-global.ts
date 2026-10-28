import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const target = new URL(process.env.DATABASE_URL || '')
  assert.equal(process.env.NODE_ENV, 'development')
  assert(['db', 'localhost', '127.0.0.1'].includes(target.hostname))
  assert.equal(target.pathname, '/quantum_sport')
  const before = await db.banner.count()
  if (!process.argv.includes('--apply')) {
    console.log(
      JSON.stringify({
        preview: true,
        bannersPreserved: before,
        scope: 'all branches',
      }),
    )
    return
  }
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      readFileSync(new URL('./global-banners.sql', import.meta.url), 'utf8'),
    )
    assert.equal(await tx.banner.count(), before)
  })
  console.log(
    JSON.stringify({ bannersPreserved: before, scope: 'all branches' }),
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
