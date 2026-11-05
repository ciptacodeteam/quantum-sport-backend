import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    paymentMethod: {
      findUnique: mocks.find,
      create: mocks.create,
      update: mocks.update,
    },
  },
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: any[]) => handlers },
}))
vi.mock('@/services/upload.service', () => ({
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  getFileUrl: vi.fn(),
}))
import {
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
} from '@/lib/validation'
import {
  createPaymentMethodHandler,
  updatePaymentMethodHandler,
} from './payment-method.handler'
const input = {
  name: 'Tunai Kasir',
  fees: '0',
  percentage: '0',
  channel: '',
  isOffline: 'true',
  isActive: 'true',
  sequence: '0',
}
const context = (form: any) => ({
  req: {
    valid: (part: string) => (part === 'param' ? { id: 'method' } : form),
  },
  json: (value: any) => value,
  var: { logger: { error: vi.fn() } },
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.find.mockResolvedValue(null)
  mocks.create.mockResolvedValue({ id: 'method' })
  mocks.update.mockResolvedValue({ id: 'method' })
})
it('creates an offline admin method without requiring a gateway channel', async () => {
  await (createPaymentMethodHandler.at(-1) as any)(
    context(createPaymentMethodSchema.parse(input)),
  )
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        name: 'Tunai Kasir',
        isOffline: true,
        channel: undefined,
      }),
    }),
  )
})
it.each(['false', '0', false, 0])(
  'parses offline flag %s as false in multipart updates',
  async (value) => {
    const form = updatePaymentMethodSchema.parse({ isOffline: value })
    expect(form.isOffline).toBe(false)
    mocks.find.mockResolvedValue({
      id: 'method',
      name: 'Tunai Kasir',
      logo: null,
      isActive: true,
      isOffline: true,
    })
    await (updatePaymentMethodHandler.at(-1) as any)(context(form))
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isOffline: false }),
      }),
    )
  },
)
it('does not reset offline visibility when updating an unrelated field', () => {
  expect(
    updatePaymentMethodSchema.parse({ name: 'Nama Baru' }).isOffline,
  ).toBeUndefined()
  expect(
    createPaymentMethodSchema.parse({ ...input, isOffline: undefined })
      .isOffline,
  ).toBe(false)
  expect(
    updatePaymentMethodSchema.safeParse({ isOffline: 'invalid' }).success,
  ).toBe(false)
})
