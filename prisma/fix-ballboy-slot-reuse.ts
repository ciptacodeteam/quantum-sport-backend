import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('Fixing ballboy slot reuse schema...')

  await db.$executeRawUnsafe(`
    ALTER TABLE booking_ballboys
    DROP CONSTRAINT IF EXISTS uq_bookingballboy_slot;
  `)

  await db.$executeRawUnsafe(`
    DROP INDEX IF EXISTS uq_bookingballboy_slot;
  `)

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS booking_ballboys_slotId_idx
    ON booking_ballboys ("slotId");
  `)

  await db.$executeRawUnsafe(`
    ALTER TABLE booking_ballboys
    ADD COLUMN IF NOT EXISTS "courtSlotId" TEXT;
  `)

  await db.$executeRawUnsafe(`
    ALTER TABLE booking_ballboys
    DROP CONSTRAINT IF EXISTS "booking_ballboys_courtSlotId_fkey";
  `)

  await db.$executeRawUnsafe(`
    ALTER TABLE booking_ballboys
    ADD CONSTRAINT "booking_ballboys_courtSlotId_fkey"
    FOREIGN KEY ("courtSlotId") REFERENCES slots(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;
  `)

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS booking_ballboys_courtSlotId_idx
    ON booking_ballboys ("courtSlotId");
  `)

  console.log('Ballboy slot reuse schema fixed.')
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
