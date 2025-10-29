import { PrismaClient } from '@prisma/client'

export const db = new PrismaClient({
  log: ['error', 'warn'],
  transactionOptions: {
    timeout: 1000 * 60 * 1, // 1 minute
  },
})
