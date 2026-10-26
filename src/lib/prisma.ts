import { PrismaClient } from '@prisma/client'
import { branchScopedClient } from './branch-scope'

const prismaClient = new PrismaClient({
  log: ['error', 'warn'],
  transactionOptions: {
    timeout: 1000 * 60 * 1, // 1 minute
  },
})

const client = global.prisma || prismaClient
export const db = branchScopedClient(client) as PrismaClient

if (process.env.NODE_ENV !== 'production') global.prisma = client
