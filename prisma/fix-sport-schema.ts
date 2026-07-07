import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('Fixing sport/value pack database schema...')

  await db.$executeRawUnsafe(`
    DO $$
    BEGIN
      CREATE TYPE "CourtSport" AS ENUM ('PADEL', 'TENNIS');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.$executeRawUnsafe(`
    DO $$
    BEGIN
      CREATE TYPE "MembershipType" AS ENUM ('ALL_HOUR', 'HAPPY_HOUR', 'AFTER_HOUR');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.$executeRawUnsafe(`
    ALTER TABLE courts
    ADD COLUMN IF NOT EXISTS sport "CourtSport" NOT NULL DEFAULT 'PADEL';
  `)

  await db.$executeRawUnsafe(`
    ALTER TABLE inventories
    ADD COLUMN IF NOT EXISTS sport "CourtSport" NOT NULL DEFAULT 'PADEL';
  `)

  await db.$executeRawUnsafe(`
    ALTER TABLE memberships
    ADD COLUMN IF NOT EXISTS sport "CourtSport" NOT NULL DEFAULT 'PADEL';
  `)

  await db.$executeRawUnsafe(`
    ALTER TABLE memberships
    ADD COLUMN IF NOT EXISTS type "MembershipType" NOT NULL DEFAULT 'ALL_HOUR';
  `)

  await db.$executeRawUnsafe(`
    UPDATE courts
    SET sport = 'PADEL'
    WHERE sport IS NULL OR name ILIKE '%padel%';
  `)

  await db.$executeRawUnsafe(`
    UPDATE courts
    SET sport = 'TENNIS'
    WHERE name ILIKE '%tennis%';
  `)

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS courts_sport_idx ON courts (sport);
  `)

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS inventories_sport_isActive_idx
    ON inventories (sport, "isActive");
  `)

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS memberships_sport_type_isActive_sequence_idx
    ON memberships (sport, type, "isActive", sequence);
  `)

  const courts = await db.$queryRaw<Array<{ sport: string; count: bigint }>>`
    SELECT sport::text, COUNT(*)::bigint AS count
    FROM courts
    GROUP BY sport
    ORDER BY sport
  `

  console.log(
    `Courts by sport: ${courts
      .map((row) => `${row.sport}=${row.count.toString()}`)
      .join(', ')}`,
  )
  console.log('Sport/value pack database schema fixed.')
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
