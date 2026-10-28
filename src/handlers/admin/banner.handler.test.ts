import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  find: vi.fn(),
  upload: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    banner: {
      create: mocks.create,
      update: mocks.update,
      findUnique: mocks.find,
    },
  },
}))
vi.mock('@/services/upload.service', () => ({
  uploadFile: mocks.upload,
  deleteFile: vi.fn(),
  getFileUrl: vi.fn(),
}))
import { createBannerHandler, updateBannerHandler } from './banner.handler'
import { createBannerSchema, updateBannerSchema } from '@/lib/validation'
const existing = {
  id: 'banner',
  image: '/old.jpg',
  startAt: new Date('2026-10-01'),
  endAt: null,
}
const context = (form: any) => ({
  req: {
    valid: (type: string) => (type === 'param' ? { id: 'banner' } : form),
  },
  var: { logger: { fatal: vi.fn() } },
  json: (value: any) => value,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.find.mockResolvedValue(existing)
  mocks.create.mockResolvedValue({ id: 'banner' })
  mocks.update.mockResolvedValue(existing)
  mocks.upload.mockResolvedValue({ relativePath: '/new.jpg' })
})
it('parses false from multipart without activating the banner', () => {
  expect(updateBannerSchema.parse({ isActive: 'false' }).isActive).toBe(false)
  expect(updateBannerSchema.parse({ isActive: 'true' }).isActive).toBe(true)
})
it('allows no target link and prevents unsafe protocols', () => {
  expect(updateBannerSchema.safeParse({ link: '' }).success).toBe(true)
  expect(
    updateBannerSchema.safeParse({ link: 'javascript:alert(1)' }).success,
  ).toBe(false)
})
it('saves sequence and inactive state on creation', async () => {
  const form = createBannerSchema.parse({
    image: new File(['image'], 'banner.jpg', { type: 'image/jpeg' }),
    isActive: 'false',
    sequence: '4',
  })
  await (createBannerHandler.at(-1) as any)(context(form))
  expect(mocks.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      sequence: 4,
      isActive: false,
      image: '/new.jpg',
    }),
  })
})
it('edits an existing banner without requiring another image and clears the link', async () => {
  const form = updateBannerSchema.parse({
    sequence: '2',
    isActive: 'false',
    link: '',
  })
  await (updateBannerHandler.at(-1) as any)(context(form))
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: 'banner' },
    data: expect.objectContaining({
      image: '/old.jpg',
      sequence: 2,
      isActive: false,
      link: null,
    }),
  })
})
