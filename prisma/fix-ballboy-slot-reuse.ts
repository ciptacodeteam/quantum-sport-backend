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
