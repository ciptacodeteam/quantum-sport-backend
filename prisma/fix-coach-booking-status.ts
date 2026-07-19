import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  await db.$executeRawUnsafe(`
    ALTER TABLE booking_coaches
      ADD COLUMN IF NOT EXISTS status "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
      ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
  `)

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS booking_coaches_status_idx
      ON booking_coaches (status);
  `)

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS booking_coaches_slotId_idx
      ON booking_coaches ("slotId");
  `)

  const updated = await db.$executeRawUnsafe(`
    UPDATE booking_coaches bc
    SET
      status = 'CANCELLED',
      "cancelledAt" = COALESCE(bc."cancelledAt", b."cancelledAt", NOW()),
      "cancellationReason" = COALESCE(
        bc."cancellationReason",
        b."cancellationReason",
        'Cancelled booking legacy data'
      )
    FROM bookings b
    WHERE b.id = bc."bookingId"
      AND b.status = 'CANCELLED'
      AND bc.status <> 'CANCELLED';
  `)

  console.log(`Marked ${updated} legacy coach booking records as cancelled.`)
}

main()
  .then(async () => {
    console.log('Coach booking status columns are ready.')
    await db.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await db.$disconnect()
    process.exit(1)
  })
