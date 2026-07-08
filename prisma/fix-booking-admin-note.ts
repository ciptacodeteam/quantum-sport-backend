import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('Fixing booking admin note schema...')

  await db.$executeRawUnsafe(`
    ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS "adminNote" TEXT;
  `)

  console.log('Booking admin note schema fixed.')
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
