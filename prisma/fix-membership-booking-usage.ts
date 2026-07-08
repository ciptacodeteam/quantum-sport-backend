import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('Fixing booking membership usage schema...')

  await db.$executeRawUnsafe(`
    ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS "membershipUserId" TEXT;
  `)

  await db.$executeRawUnsafe(`
    ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS "membershipSessionsUsed" INTEGER NOT NULL DEFAULT 0;
  `)

  await db.$executeRawUnsafe(`
    DO $$
    BEGIN
      ALTER TABLE bookings
      ADD CONSTRAINT "bookings_membershipUserId_fkey"
      FOREIGN KEY ("membershipUserId")
      REFERENCES membership_users(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "bookings_membershipUserId_idx"
    ON bookings ("membershipUserId");
  `)

  console.log('Booking membership usage schema fixed.')
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
