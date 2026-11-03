import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  upload: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: { coachingGroup: { findMany: mocks.list } },
}))
vi.mock('@/services/coaching-group.service', async (original) => ({
  ...(await original<typeof import('@/services/coaching-group.service')>()),
  saveCoachingGroup: mocks.save,
  saveCoachingGroupUpload: mocks.upload,
}))
import route from './coaching-group.route'
const app = (role?: string) => {
  const a = new Hono<any>()
  a.use('*', async (c, next) => {
    if (role) c.set('admin', { id: 'actor', role })
    await next()
  })
  a.route('/admin', route)
  return a
}
const input = {
  name: 'Northwest',
  description: '',
  logo: '',
  sports: ['PADEL', 'TENNIS'],
  branchIds: ['cemara'],
  isActive: true,
}
const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([])
  mocks.save.mockResolvedValue({ id: 'northwest' })
  mocks.upload.mockResolvedValue({ id: 'northwest' })
})
it('lets a super admin create a shared group and limits list results to the requested branch', async () => {
  expect(
    (await app('SUPER_ADMIN').request('/admin/coaching-groups', post(input)))
      .status,
  ).toBe(201)
  expect(mocks.save).toHaveBeenCalledWith(undefined, input)
  expect(
    (await app('ADMIN').request('/admin/coaching-groups?branchId=cemara'))
      .status,
  ).toBe(200)
  expect(mocks.list.mock.calls[0][0].where).toEqual({
    branches: { some: { branchId: 'cemara' } },
  })
})
it.each(['ADMIN', 'CASHIER', 'ADMIN_VIEWER', 'COACH', 'BALLBOY', undefined])(
  'blocks group changes by %s',
  async (role) => {
    expect([401, 403]).toContain(
      (await app(role).request('/admin/coaching-groups', post(input))).status,
    )
    expect(mocks.save).not.toHaveBeenCalled()
  },
)
it.each([
  { sports: [] },
  { branchIds: [] },
  { logo: 'javascript:alert(1)' },
  { sports: ['PADEL', 'PADEL'] },
  { branchIds: ['cemara', 'cemara'] },
])('rejects invalid group configuration %j', async (change) => {
  expect(
    (
      await app('SUPER_ADMIN').request(
        '/admin/coaching-groups',
        post({ ...input, ...change }),
      )
    ).status,
  ).toBe(422)
  expect(mocks.save).not.toHaveBeenCalled()
})

const form = (file?: File) => {
  const body = new FormData()
  body.append('data', JSON.stringify(input))
  if (file) body.append('logo', file)
  return body
}
it('accepts a local logo file with multipart group data', async () => {
  const file = new File(['image'], 'logo.png', { type: 'image/png' })
  const response = await app('SUPER_ADMIN').request('/admin/coaching-groups', {
    method: 'POST',
    body: form(file),
  })
  expect(response.status).toBe(201)
  const uploaded = mocks.upload.mock.calls[0][1]
  expect(uploaded.data).toEqual(input)
  expect(uploaded.logo.name).toBe('logo.png')
  expect(uploaded.removeLogo).toBe(false)
})
it.each([
  new File(['svg'], 'logo.svg', { type: 'image/svg+xml' }),
  new File([], 'empty.png', { type: 'image/png' }),
  new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {
    type: 'image/png',
  }),
])(
  'rejects an unsupported, empty or oversized logo before uploading',
  async (file) => {
    expect(
      (
        await app('SUPER_ADMIN').request('/admin/coaching-groups', {
          method: 'POST',
          body: form(file),
        })
      ).status,
    ).toBe(422)
    expect(mocks.upload).not.toHaveBeenCalled()
  },
)
it('rejects malformed multipart settings and simultaneous upload/removal', async () => {
  const invalid = new FormData()
  invalid.append('data', '{broken')
  expect(
    (
      await app('SUPER_ADMIN').request('/admin/coaching-groups', {
        method: 'POST',
        body: invalid,
      })
    ).status,
  ).toBe(422)
  const conflict = form(new File(['image'], 'logo.png', { type: 'image/png' }))
  conflict.append('removeLogo', 'true')
  expect(
    (
      await app('SUPER_ADMIN').request('/admin/coaching-groups', {
        method: 'POST',
        body: conflict,
      })
    ).status,
  ).toBe(422)
  expect(mocks.upload).not.toHaveBeenCalled()
})
