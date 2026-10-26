import { createRouter } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'

export const branchFields = {
  id: true,
  name: true,
  address: true,
  mapsUrl: true,
  isActive: true,
  sequence: true,
} as const
const branchRoute = createRouter().get('/branches', async (c) => {
  const branches = await db.branch.findMany({
    where: { isActive: true },
    select: branchFields,
    orderBy: [{ sequence: 'asc' }, { name: 'asc' }],
  })
  return c.json(ok(branches))
})
export default branchRoute
