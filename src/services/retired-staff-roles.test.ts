import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ db: {} }))
import { assertStaffActive } from './account-status.service'
import { createStaffSchema, updateStaffSchema } from '@/lib/validation'

const valid = {
  name: 'Test Staff',
  email: 'staff@example.test',
  phone: '+6281234567890',
  password: 'test1234',
  confirmPassword: 'test1234',
  joinedAt: '2026-10-28',
}
describe('retired staff roles', () => {
  it.each(['COACH', 'BALLBOY'])(
    'rejects creating, assigning, and authenticating %s',
    async (role) => {
      expect(createStaffSchema.safeParse({ ...valid, role }).success).toBe(
        false,
      )
      expect(updateStaffSchema.safeParse({ role }).success).toBe(false)
      await expect(
        assertStaffActive({ id: 'old', isActive: true, role }),
      ).rejects.toThrow()
    },
  )
  it.each(['SUPER_ADMIN', 'ADMIN', 'ADMIN_VIEWER', 'CASHIER'])(
    'preserves the %s role',
    async (role) => {
      expect(createStaffSchema.safeParse({ ...valid, role }).success).toBe(true)
      expect(updateStaffSchema.safeParse({ role }).success).toBe(true)
      await expect(
        assertStaffActive({ id: 'active', isActive: true, role }),
      ).resolves.toBeUndefined()
    },
  )
  it('still blocks inactive accounts with a supported role', async () => {
    await expect(
      assertStaffActive({ id: 'inactive', isActive: false, role: 'ADMIN' }),
    ).rejects.toThrow()
  })
})
