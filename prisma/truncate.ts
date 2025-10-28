import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const tablenames = await db.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`

  const tables = tablenames
    .map(({ tablename }: { tablename: string }) => tablename)
    .filter((name: string) => name !== '_prisma_migrations')
    .map((name: any) => `"public"."${name}"`)
    .join(', ')

  try {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`)
  } catch (error) {
    console.log({ error })
    throw new Error('Failed to truncate tables')
  }

  console.log('🚀 Truncated all tables')
}

main()
  .then(async () => {
    await db.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
