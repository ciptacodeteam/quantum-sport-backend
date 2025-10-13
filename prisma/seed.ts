import { PrismaClient } from '../generated/prisma'

const db = new PrismaClient()

async function main() {
  console.info('🌱 Seeding database')

  // Seed your database here
  //   await userSeed(db);

  console.info('🌱 Database seeding complete')
}

main()
  .then(async () => {
    await db.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
