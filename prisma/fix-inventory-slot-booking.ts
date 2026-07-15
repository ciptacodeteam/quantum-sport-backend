import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({
  log: ['error', 'warn'],
})

async function main() {
  await db.$executeRawUnsafe(`
    ALTER TABLE booking_inventories
    ADD COLUMN IF NOT EXISTS "slotId" TEXT
  `)

  await db.$executeRawUnsafe(`
    ALTER TABLE booking_inventories
    ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3)
  `)

  const existingConstraint = await db.$queryRaw<
    Array<{ constraint_name: string }>
  >`
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE constraint_name = 'booking_inventories_slotId_fkey'
      AND table_name = 'booking_inventories'
  `

  if (existingConstraint.length === 0) {
    await db.$executeRawUnsafe(`
      ALTER TABLE booking_inventories
      ADD CONSTRAINT "booking_inventories_slotId_fkey"
      FOREIGN KEY ("slotId") REFERENCES slots(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `)
  }

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "booking_inventories_slotId_idx"
    ON booking_inventories ("slotId")
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
