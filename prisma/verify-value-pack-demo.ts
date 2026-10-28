import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
async function main() {
  assert.equal(process.env.NODE_ENV, 'development')
  const report = JSON.parse(
    readFileSync('.backups/demo-data-report.json', 'utf8'),
  )
  const results: {
    branch: string
    records: number
    sportFilters: string
    statusAndExportFilters: string
  }[] = []
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
    const headers = {
      Authorization: `Bearer ${auth.data.token}`,
      'X-Branch-ID': branch,
    }
    const get = async (query = '') => {
      const response = await fetch(
        `http://localhost:8000/admin/membership-transactions${query}`,
        { headers },
      )
      assert.equal(response.status, 200)
      return ((await response.json()) as any).data
    }
    const all = await get()
    assert.equal(all.length, 12)
    for (const row of all) {
      assert.equal(row.invoice.branchId, branch)
      assert(row.user.name && row.membership.name && row.invoice.number)
    }
    for (const sport of ['PADEL', 'TENNIS'])
      assert.equal((await get(`?sport=${sport}`)).length, 6)
    for (const status of [
      'Aktif',
      'Menunggu pembayaran',
      'Ditangguhkan',
      'Kedaluwarsa',
      'Sesi habis',
      'Dibatalkan',
    ]) {
      const params = new URLSearchParams({ status, sport: 'PADEL' })
      assert.equal((await get(`?${params}`)).length, 1)
      const excel = await fetch(
        `http://localhost:8000/admin/membership-transactions/export/excel?${params}`,
        { headers },
      )
      assert.equal(excel.status, 200)
      const book = XLSX.read(await excel.arrayBuffer())
      assert.equal(
        XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]).length,
        1,
      )
    }
    results.push({
      branch,
      records: all.length,
      sportFilters: 'passed',
      statusAndExportFilters: 'passed',
    })
  }
  assert.equal(
    await db.invoice.count({
      where: { membershipUserId: { startsWith: 'demo-value-pack-' } },
    }),
    24,
  )
  console.log(JSON.stringify({ passed: true, results }))
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
