import { expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createFactory } from 'hono/factory'
import type { AppEnv } from '@/types'
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: { user: { findMany: mocks.findMany } } }))
vi.mock('@/lib/create-app', () => ({ factory: createFactory<AppEnv>() }))
vi.mock('@/services/password-reset.service', () => ({
  buildPasswordResetLink: vi.fn(),
  createPasswordResetToken: vi.fn(),
}))
vi.mock('@/services/upload.service', () => ({
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
}))
import { getAllUsersHandler } from './user.handler'

it('returns stored Management categories and validity dates for the customer table', async () => {
  const records = [
    {
      id: 'management',
      name: 'Management BPC',
      isManagement: true,
      managementValidFrom: new Date('2026-11-01T00:00:00Z'),
      managementValidUntil: new Date('2026-12-31T00:00:00Z'),
    },
    {
      id: 'regular',
      name: 'Pelanggan Reguler',
      isManagement: false,
      managementValidFrom: null,
      managementValidUntil: null,
    },
  ]
  // Emulate Prisma selection so missing fields cannot be hidden by a full-row mock.
  mocks.findMany.mockImplementation(async ({ select }) =>
    records.map((record) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => select[key])),
    ),
  )
  const app = new Hono<AppEnv>()
  app.get('/customers', ...getAllUsersHandler)
  const response = await app.request('/customers')
  expect(response.status).toBe(200)
  const body = (await response.json()) as { data: unknown }
  expect(body.data).toEqual([
    {
      id: 'management',
      name: 'Management BPC',
      isManagement: true,
      managementValidFrom: '2026-11-01T00:00:00.000Z',
      managementValidUntil: '2026-12-31T00:00:00.000Z',
    },
    {
      id: 'regular',
      name: 'Pelanggan Reguler',
      isManagement: false,
      managementValidFrom: null,
      managementValidUntil: null,
    },
  ])
})
