import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// Repair only known legacy seed values; preserve custom channels, fees, IDs,
// and all existing invoices/payments. No requests are sent to Xendit.
const channels = [
  { name: 'BCA Virtual Account', channel: 'BCA_VIRTUAL_ACCOUNT' },
  { name: 'Mandiri Virtual Account', channel: 'MANDIRI_VIRTUAL_ACCOUNT' },
]

async function main() {
  await db.$transaction(async (tx) => {
    for (const method of channels) {
      const result = await tx.paymentMethod.updateMany({
        where: { name: method.name, channel: 'VA' },
        data: { channel: method.channel },
      })
      console.log(`${method.name}: ${result.count} legacy channel updated`)
    }
    const methods = await tx.paymentMethod.findMany({
      where: { name: { in: channels.map((method) => method.name) } },
      select: { name: true, channel: true },
    })
    console.log(methods)
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
