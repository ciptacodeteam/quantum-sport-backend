import type { MiddlewareHandler } from 'hono'
import { BadRequestException, ForbiddenException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { withBranchContext } from '@/lib/branch-context'

const publicBranchPaths = [
  '/courts',
  '/coaches',
  '/ballboys',
  '/inventories',
  '/classes',
  '/partnerships',
  '/checkout',
]
const sharedCustomerPaths = ['/memberships/my', '/memberships/my/tracking']
export const branchMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path
  const isAdmin = path.startsWith('/admin/')
  const authPath = path.startsWith('/admin/auth/')
  if (authPath || path === '/branches' || path.startsWith('/branches/'))
    return next()
  let requested = c.req.header('X-Branch-ID')
  if (isAdmin) {
    const admin = c.get('admin')
    if (!admin?.id) return next() // Authentication middleware handles this case.
    const staff = await db.staff.findUnique({
      where: { id: admin.id },
      select: { role: true, branchId: true, isActive: true },
    })
    if (!staff?.isActive) throw new ForbiddenException('Akun staf tidak aktif.')
    const isSuperAdmin = staff.role === 'SUPER_ADMIN'
    // Banner content is shared across locations; branch selection does not scope it.
    if (path === '/admin/banners' || path.startsWith('/admin/banners/'))
      return withBranchContext(
        { branchId: null, isAdmin: true, isSuperAdmin, staffId: admin.id },
        next,
      )
    if (!isSuperAdmin && requested && requested !== staff.branchId)
      throw new ForbiddenException(
        'Akun Anda hanya dapat mengakses cabang yang ditugaskan.',
      )
    const branchId = isSuperAdmin
      ? requested && requested !== 'all'
        ? requested
        : null
      : staff.branchId
    if (branchId) {
      const branch = await db.branch.findFirst({
        where: { id: branchId },
      })
      if (!branch) throw new ForbiddenException('Cabang tidak ditemukan.')
    }
    c.set('branchId', branchId)
    return withBranchContext(
      {
        branchId,
        isAdmin: true,
        isSuperAdmin,
        membershipMode:
          path.startsWith('/admin/membership-transactions') ||
          path.startsWith('/admin/analytics')
            ? 'sales'
            : 'wallet',
        staffId: admin.id,
      },
      next,
    )
  }
  if (
    !publicBranchPaths.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ) ||
    sharedCustomerPaths.includes(path)
  )
    return next()
  // Cancel-session is protected by invoice ownership and must work after changing branch.
  if (path === '/checkout/cancel-session') return next()
  if (!requested) {
    const active = await db.branch.findMany({
      where: { isActive: true },
      select: { id: true },
    })
    if (active.length === 1) requested = active[0].id
  }
  if (!requested || requested === 'all')
    throw new BadRequestException('Pilih cabang terlebih dahulu.')
  const branch = await db.branch.findFirst({
    where: { id: requested, isActive: true },
  })
  if (!branch)
    throw new BadRequestException('Cabang tidak aktif atau tidak ditemukan.')
  c.set('branchId', branch.id)
  return withBranchContext(
    { branchId: branch.id, isAdmin: false, isSuperAdmin: false },
    next,
  )
}
