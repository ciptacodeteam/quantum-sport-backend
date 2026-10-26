import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createRouter } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { requireRole } from '@/middlewares/auth'
import { branchFields } from '../branch.route'
import { validateHook } from '@/helpers/validate-hook'
import { BadRequestException } from '@/exceptions'
const schema = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().min(5).max(1000),
  mapsUrl: z.url().nullable().optional(),
  isActive: z.boolean().default(true),
  sequence: z.number().int().min(0).default(0),
})
const branchRoute = createRouter()
  .basePath('/branches')
  .get('/', async (c) => {
    const admin = c.get('admin')!
    const staff = await db.staff.findUnique({
      where: { id: admin.id },
      select: { branchId: true },
    })
    const items = await db.branch.findMany({
      where: admin.role === 'SUPER_ADMIN' ? {} : { id: staff?.branchId ?? '' },
      select: branchFields,
      orderBy: { sequence: 'asc' },
    })
    return c.json(ok(items))
  })
  .get('/staff', requireRole('SUPER_ADMIN'), async (c) => {
    const items = await db.staff.findMany({
      select: { id: true, name: true, role: true, branchId: true },
      orderBy: { name: 'asc' },
    })
    return c.json(ok(items))
  })
  .get('/memberships', requireRole('SUPER_ADMIN'), async (c) => {
    const items = await db.membership.findMany({
      select: {
        id: true,
        name: true,
        branches: { select: { branchId: true } },
      },
      orderBy: { sequence: 'asc' },
    })
    return c.json(ok(items))
  })
  .put(
    '/membership/:id',
    requireRole('SUPER_ADMIN'),
    zValidator(
      'json',
      z.object({ branchIds: z.array(z.string().min(1)).min(1) }),
      validateHook,
    ),
    async (c) => {
      const branchIds = [...new Set(c.req.valid('json').branchIds)]
      const count = await db.branch.count({ where: { id: { in: branchIds } } })
      if (count !== branchIds.length)
        throw new BadRequestException('Cabang tidak ditemukan.')
      await db.$transaction(async (tx) => {
        await tx.membership.findUniqueOrThrow({
          where: { id: c.req.param('id') },
        })
        await tx.membershipBranch.deleteMany({
          where: { membershipId: c.req.param('id') },
        })
        await tx.membershipBranch.createMany({
          data: branchIds.map((branchId) => ({
            membershipId: c.req.param('id'),
            branchId,
          })),
        })
      })
      return c.json(ok(null))
    },
  )
  .post(
    '/',
    requireRole('SUPER_ADMIN'),
    zValidator('json', schema, validateHook),
    async (c) => {
      const branch = await db.branch.create({
        data: c.req.valid('json'),
        select: branchFields,
      })
      return c.json(ok(branch), 201)
    },
  )
  .put(
    '/:id',
    requireRole('SUPER_ADMIN'),
    zValidator('json', schema.partial(), validateHook),
    async (c) => {
      const branch = await db.branch.update({
        where: { id: c.req.param('id') },
        data: c.req.valid('json'),
        select: branchFields,
      })
      return c.json(ok(branch))
    },
  )
  // Staff can be reassigned only through this super-admin endpoint, outside a branch scope.
  .put(
    '/staff/:staffId',
    requireRole('SUPER_ADMIN'),
    zValidator('json', z.object({ branchId: z.string().min(1) }), validateHook),
    async (c) => {
      const { branchId } = c.req.valid('json')
      if (
        !(await db.branch.findFirst({
          where: { id: branchId, isActive: true },
        }))
      )
        throw new BadRequestException('Cabang tidak aktif.')
      const existing = await db.staff.findUniqueOrThrow({
        where: { id: c.req.param('staffId') },
        select: { branchId: true, _count: { select: { slot: true } } },
      })
      if (existing.branchId !== branchId && existing._count.slot > 0)
        throw new BadRequestException(
          'Staf memiliki jadwal yang terikat cabang asal. Buat akun staf untuk cabang tujuan agar riwayat booking tetap benar.',
        )
      const staff = await db.staff.update({
        where: { id: c.req.param('staffId') },
        data: { branchId },
        select: { id: true, branchId: true },
      })
      return c.json(ok(staff))
    },
  )
export default branchRoute
