import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  tx: {} as any,
}))
vi.mock('@/lib/prisma', () => ({
  db: { $transaction: (fn: any) => fn(mocks.tx) },
}))
vi.mock('./upload.service', () => ({
  uploadFile: mocks.upload,
  deleteFile: mocks.remove,
}))
import { saveCoachingGroupUpload } from './coaching-group.service'
const fields = {
  name: 'Northwest',
  description: '',
  logo: '',
  sports: ['PADEL'] as 'PADEL'[],
  branchIds: ['cemara'],
  isActive: true,
}
const file = new File(['image'], 'logo.png', { type: 'image/png' })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.upload.mockResolvedValue({
    absolutePath: 'https://blob.example/coaching-groups/new.webp',
    relativePath: 'coaching-groups/new.webp',
  })
  mocks.remove.mockResolvedValue(true)
  mocks.find.mockResolvedValue({
    id: 'group',
    logo: 'https://blob.example/old.webp',
  })
  mocks.update.mockImplementation(async ({ data }) => ({
    id: 'group',
    ...data,
  }))
  mocks.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }))
  mocks.tx = {
    $queryRaw: vi.fn(),
    coachingGroup: {
      findUnique: mocks.find,
      update: mocks.update,
      create: mocks.create,
    },
    branch: { count: vi.fn().mockResolvedValue(1) },
  }
})
it('keeps the stored logo when updating without another upload', async () => {
  const result = await saveCoachingGroupUpload('group', {
    data: fields,
    removeLogo: false,
  })
  expect(result.logo).toBe('https://blob.example/old.webp')
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
})
it('uploads through the shared image storage and saves its public URL', async () => {
  const result = await saveCoachingGroupUpload(undefined, {
    data: fields,
    logo: file,
    removeLogo: false,
  })
  expect(mocks.upload).toHaveBeenCalledWith(file, { subdir: 'coaching-groups' })
  expect(result.logo).toBe('https://blob.example/coaching-groups/new.webp')
})
it('allows clearing the logo explicitly', async () => {
  expect(
    (await saveCoachingGroupUpload('group', { data: fields, removeLogo: true }))
      .logo,
  ).toBeNull()
  expect(mocks.upload).not.toHaveBeenCalled()
})
it('cleans up only the new asset if saving the group fails', async () => {
  mocks.update.mockRejectedValueOnce(new Error('save failed'))
  await expect(
    saveCoachingGroupUpload('group', {
      data: fields,
      logo: file,
      removeLogo: false,
    }),
  ).rejects.toThrow('save failed')
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(
    'https://blob.example/coaching-groups/new.webp',
  )
})
it('leaves the existing group untouched if uploading fails', async () => {
  mocks.upload.mockRejectedValueOnce(new Error('upload failed'))
  await expect(
    saveCoachingGroupUpload('group', {
      data: fields,
      logo: file,
      removeLogo: false,
    }),
  ).rejects.toThrow('upload failed')
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
})
