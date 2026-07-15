import { db } from '../src/lib/prisma'

async function main() {
  await db.$executeRawUnsafe(`
    ALTER TABLE booking_inventories
    ADD COLUMN IF NOT EXISTS "slotId" TEXT;

    ALTER TABLE booking_inventories
    ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'booking_inventories_slotId_fkey'
          AND table_name = 'booking_inventories'
      ) THEN
        ALTER TABLE booking_inventories
        ADD CONSTRAINT "booking_inventories_slotId_fkey"
        FOREIGN KEY ("slotId") REFERENCES slots(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL;
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS "booking_inventories_slotId_idx"
    ON booking_inventories ("slotId");
  `)
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
