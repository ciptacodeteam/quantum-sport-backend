import { db } from '../src/lib/prisma'

async function main() {
  await db.$executeRawUnsafe(`
    ALTER TABLE booking_ballboys
      ADD COLUMN IF NOT EXISTS status "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
      ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
  `)

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS booking_ballboys_status_idx
      ON booking_ballboys (status);
  `)
}

main()
  .then(async () => {
    console.log('Ballboy booking status columns are ready.')
    await db.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await db.$disconnect()
    process.exit(1)
  })
