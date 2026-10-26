import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  await db.$executeRawUnsafe(`
    ALTER TABLE "inventories"
    ADD COLUMN IF NOT EXISTS "image" TEXT
  `)

  // Verify that the current Prisma model can read every inventory field.
  await db.inventory.findFirst()
  console.log(
    'Inventory image column is available. Existing data is preserved.',
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
