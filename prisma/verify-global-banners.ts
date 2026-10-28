import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { branchScopedClient } from '../src/lib/branch-scope'
import { withBranchContext } from '../src/lib/branch-context'

const raw = new PrismaClient()
const db = branchScopedClient(raw) as PrismaClient
async function main() {
  assert.equal(process.env.NODE_ENV, 'development')
  const report = JSON.parse(
    readFileSync('.backups/demo-data-report.json', 'utf8'),
  )
  const collections: string[][] = []
  for (const branch of ['cemara', 's-parman']) {
    const login = await fetch('http://localhost:8000/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `admin.${branch}@demo.quantum.test`,
        password: report.dummyPassword,
      }),
    })
    assert.equal(login.status, 200)
    const auth = (await login.json()) as any
    const response = await fetch('http://localhost:8000/admin/banners', {
      headers: {
        Authorization: `Bearer ${auth.data.token}`,
        'X-Branch-ID': branch,
      },
    })
    assert.equal(response.status, 200)
    collections.push(
      ((await response.json()) as any).data
        .map((banner: any) => banner.id)
        .sort(),
    )
  }
  assert.deepEqual(collections[0], collections[1])
  for (const branch of [undefined, 'cemara', 's-parman']) {
    const response = await fetch('http://localhost:8000/banners', {
      headers: branch ? { 'X-Branch-ID': branch } : {},
    })
    assert.equal(response.status, 200)
  }
  const rollback = new Error('ROLLBACK_TEST_ONLY')
  const context = (branchId: string | null, action: () => Promise<unknown>) =>
    withBranchContext(
      { branchId, isAdmin: true, isSuperAdmin: true, staffId: 'verification' },
      action,
    )
  try {
    await db.$transaction(async (tx) => {
      const banner = (await context(null, () =>
        tx.banner.create({
          data: { image: '/verification-only.jpg', isActive: false },
        }),
      )) as { id: string }
      for (const branch of ['cemara', 's-parman']) {
        assert(
          await context(branch, () =>
            tx.banner.findUnique({ where: { id: banner.id } }),
          ),
        )
      }
      await context('s-parman', () =>
        tx.banner.update({ where: { id: banner.id }, data: { sequence: 7 } }),
      )
      const updated = (await context('cemara', () =>
        tx.banner.findUniqueOrThrow({ where: { id: banner.id } }),
      )) as { sequence: number }
      assert.equal(updated.sequence, 7)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
  console.log(
    JSON.stringify({
      passed: true,
      sharedAdminLists: true,
      publicWithoutBranch: true,
      crossBranchWriteAndRead: true,
      testRecordsRolledBack: true,
    }),
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => raw.$disconnect())
