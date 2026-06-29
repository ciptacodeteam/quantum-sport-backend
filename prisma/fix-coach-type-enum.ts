import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('Fixing CoachType enum values...')

  await db.$executeRawUnsafe(`
    ALTER TYPE "CoachType" ADD VALUE IF NOT EXISTS 'PADEL';
  `)
  await db.$executeRawUnsafe(`
    ALTER TYPE "CoachType" ADD VALUE IF NOT EXISTS 'PADEL_TENNIS';
  `)
  await db.$executeRawUnsafe(`
    ALTER TYPE "CoachType" ADD VALUE IF NOT EXISTS 'TENNIS';
  `)

  await db.$executeRawUnsafe(`
    UPDATE "staff"
    SET "coachType" = 'PADEL_TENNIS'
    WHERE "coachType"::text = 'GUIDED_MATCH';
  `)
  await db.$executeRawUnsafe(`
    UPDATE "staff"
    SET "coachType" = 'PADEL'
    WHERE "coachType"::text = 'COACH';
  `)

  const values = await db.$queryRaw<Array<{ enumlabel: string }>>`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'CoachType'
    ORDER BY e.enumsortorder
  `

  console.log(`CoachType enum values: ${values.map((value) => value.enumlabel).join(', ')}`)
  console.log('CoachType data migration completed.')
}

main()
  .then(async () => {
    await db.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await db.$disconnect()
    process.exit(1)
  })
