import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import clubTime from '../src/lib/club-time'

const db = new PrismaClient()
async function main() {
  assert.equal(process.env.NODE_ENV, 'development')
  const reportPath = '.backups/demo-data-report.json'
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const today = clubTime().format('YYYY-MM-DD')
  const checks: {
    branch: string
    path: string
    status: number
    records?: number
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
    assert.equal(login.status, 200, `Admin login failed for ${branch}`)
    const authentication = (await login.json()) as { data: { token: string } }
    assert(authentication.data.token)
    const headers = {
      Authorization: `Bearer ${authentication.data.token}`,
      'X-Branch-ID': branch,
    }
    for (const path of [
      '/admin/auth/profile',
      '/admin/courts',
      '/admin/staffs',
      '/admin/bookings?limit=100',
      '/admin/bookings/schedule?limit=100',
      '/admin/bookings/ongoing-schedule',
      '/admin/analytics/dashboard',
      '/admin/analytics/daily-transactions?period=7days',
      `/admin/courts/slots?startAt=${today}&endAt=${today}&includeUnavailable=true`,
      '/admin/inventory',
      '/admin/memberships',
    ]) {
      const response = await fetch(`http://localhost:8000${path}`, { headers })
      const body = (await response.json()) as {
        success?: boolean
        msg?: string
        data?: any
      }
      assert.equal(response.status, 200, `${branch} ${path}: ${body.msg}`)
      assert.equal(body.success, true, `${branch} ${path}: ${body.msg}`)
      if (path === '/admin/courts')
        assert.equal(body.data.length, branch === 'cemara' ? 4 : 3)
      // Staff list intentionally hides the currently logged-in admin.
      if (path === '/admin/staffs') assert.equal(body.data.length, 3)
      if (path === '/admin/bookings?limit=100')
        assert.equal(body.data.length, 15)
      if (path.startsWith('/admin/bookings/schedule')) {
        const sample = body.data
          .flatMap((booking: any) => booking.details)
          .find((detail: any) => detail.slot)
        assert(sample, 'Schedule has no slots')
        // Schedule API emits club-local strings, matching the frontend calendar grid.
        const slot = await db.slot.findUniqueOrThrow({
          where: { id: sample.slot.id },
        })
        assert.equal(
          sample.slot.startAt,
          clubTime(slot.startAt).format('YYYY-MM-DD HH:mm:ss'),
        )
      }
      checks.push({
        branch,
        path,
        status: response.status,
        records: Array.isArray(body.data) ? body.data.length : undefined,
      })
    }
  }
  for (const key of ['viewer', 'cashier-1']) {
    const login = await fetch('http://localhost:8000/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${key}.cemara@demo.quantum.test`,
        password: report.dummyPassword,
      }),
    })
    assert.equal(login.status, 200, `${key} login failed`)
  }
  const bookingsBySport = await db.$queryRaw<
    { sport: string; count: bigint }[]
  >`SELECT c.sport, count(DISTINCT b.id) AS count FROM bookings b JOIN booking_details d ON d."bookingId"=b.id JOIN courts c ON c.id=d."courtId" GROUP BY c.sport`
  assert.deepEqual(
    Object.fromEntries(
      bookingsBySport.map((row) => [row.sport, Number(row.count)]),
    ),
    { PADEL: 15, TENNIS: 15 },
  )
  const invalidDays = await db.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) FROM (SELECT "courtId", ("startAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date FROM slots WHERE type='COURT' GROUP BY "courtId", ("startAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date HAVING count(*) <> 18) d`
  assert.equal(Number(invalidDays[0].count), 0)
  const resourceOverlap = await db.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) FROM (SELECT "slotId" FROM booking_coaches WHERE status <> 'CANCELLED' GROUP BY "slotId" HAVING count(*) > 1 UNION ALL SELECT "slotId" FROM booking_ballboys WHERE status <> 'CANCELLED' GROUP BY "slotId" HAVING count(*) > 1) d`
  assert.equal(Number(resourceOverlap[0].count), 0)
  report.apiChecks = checks
  report.verifiedAt = clubTime().format()
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(
    JSON.stringify(
      {
        passed: true,
        apiChecks: checks,
        roleLogins: ['ADMIN (both branches)', 'ADMIN_VIEWER', 'CASHIER'],
        bookingsBySport: bookingsBySport.map((row) => ({
          ...row,
          count: Number(row.count),
        })),
        openingHours:
          'Every court has 18 one-hour slots per day, 06:00–00:00 WIB.',
      },
      null,
      2,
    ),
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
