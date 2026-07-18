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

  const updated = await db.$executeRawUnsafe(`
    UPDATE booking_ballboys bb
    SET
      status = 'CANCELLED',
      "cancelledAt" = COALESCE(bb."cancelledAt", b."cancelledAt", NOW()),
      "cancellationReason" = COALESCE(
        bb."cancellationReason",
        b."cancellationReason",
        'Cancelled booking legacy data'
      )
    FROM bookings b
    WHERE b.id = bb."bookingId"
      AND b.status = 'CANCELLED'
      AND bb.status <> 'CANCELLED';
  `)

  console.log(`Marked ${updated} legacy ballboy booking records as cancelled.`)
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
