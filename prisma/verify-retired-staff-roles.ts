import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
async function main() {
  assert.equal(process.env.NODE_ENV, 'development')
  const report = JSON.parse(
    readFileSync('.backups/demo-data-report.json', 'utf8'),
  )
  const login = (email: string) =>
    fetch('http://localhost:8000/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: report.dummyPassword }),
    })
  for (const branch of ['cemara', 's-parman']) {
    const response = await login(`admin.${branch}@demo.quantum.test`)
    assert.equal(response.status, 200)
    const auth = (await response.json()) as any
    const headers = {
      Authorization: `Bearer ${auth.data.token}`,
      'X-Branch-ID': branch,
    }
    const list = await fetch('http://localhost:8000/admin/staffs', { headers })
    assert.equal(list.status, 200)
    const body = (await list.json()) as any
    assert.equal(body.data.length, 3)
    assert(
      body.data.every(
        (staff: any) => !['COACH', 'BALLBOY'].includes(staff.role),
      ),
    )
    for (const key of ['coach-padel', 'ballboy-1'])
      assert.equal(
        (await login(`${key}.${branch}@demo.quantum.test`)).status,
        403,
      )
  }
  assert.equal(
    await db.staff.count({
      where: { role: { in: ['COACH', 'BALLBOY'] }, isActive: true },
    }),
    0,
  )
  console.log(
    JSON.stringify({
      passed: true,
      branches: 2,
      retiredRoleLoginsBlocked: 4,
      activeRetiredRoleAccounts: 0,
    }),
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
