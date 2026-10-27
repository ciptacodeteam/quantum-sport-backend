import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  assert.equal(process.env.NODE_ENV, 'development')
  const report = JSON.parse(
    readFileSync('.backups/demo-data-report.json', 'utf8'),
  )
  const before = await db.booking.count()
  const login = async (path: string, payload: object) => {
    const response = await fetch(`http://localhost:8000${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    assert.equal(response.status, 200)
    return ((await response.json()) as any).data.token as string
  }
  let adminToken = ''
  for (const branch of ['cemara', 's-parman']) {
    const token = await login('/admin/auth/login', {
      email: `admin.${branch}@demo.quantum.test`,
      password: report.dummyPassword,
    })
    if (branch === 's-parman') adminToken = token
    for (const path of [
      '/courts?courtSport=TENNIS',
      '/admin/courts?courtSport=TENNIS',
    ]) {
      const response = await fetch(`http://localhost:8000${path}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Branch-ID': branch },
      })
      assert.equal(response.status, 200)
      const body = (await response.json()) as any
      assert.equal(body.data.length, branch === 'cemara' ? 1 : 0)
      assert(body.data.every((court: any) => court.branchId === 'cemara'))
    }
  }
  const user = await db.user.findUniqueOrThrow({
    where: { id: 'demo-customer-1' },
  })
  const userToken = await login('/auth/login', {
    phone: user.phone,
    password: report.dummyPassword,
  })
  const unavailable = await db.slot.findFirstOrThrow({
    where: {
      court: { sport: 'TENNIS', branchId: 's-parman' },
      isAvailable: true,
      startAt: { gt: new Date() },
    },
  })
  const method = await db.paymentMethod.findFirstOrThrow({
    where: { isActive: true, channel: 'QRIS' },
  })
  for (const [path, token, payload] of [
    [
      '/checkout',
      userToken,
      {
        courtSlots: [unavailable.id],
        paymentMethodId: method.id,
        useMembership: false,
      },
    ],
    [
      '/admin/checkout',
      adminToken,
      {
        userId: user.id,
        courtSlots: [unavailable.id],
        totalHours: 1,
        useMembership: false,
      },
    ],
  ] as const) {
    const response = await fetch(`http://localhost:8000${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Branch-ID': 's-parman',
      },
      body: JSON.stringify(payload),
    })
    assert.equal(response.status, 400)
    assert.match(
      JSON.stringify(await response.json()),
      /court slots not found or unavailable/,
    )
  }
  const form = new FormData()
  form.set('name', 'Forbidden Tennis Test')
  form.set('sport', 'TENNIS')
  const create = await fetch('http://localhost:8000/admin/courts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'X-Branch-ID': 's-parman',
    },
    body: form,
  })
  assert.equal(create.status, 400)
  assert.match(
    JSON.stringify(await create.json()),
    /Tennis hanya tersedia di cabang Cemara/,
  )
  assert.equal(await db.booking.count(), before)
  assert.equal(
    await db.court.count({
      where: { sport: 'TENNIS', branchId: { not: 'cemara' }, isActive: true },
    }),
    0,
  )
  console.log(
    JSON.stringify({
      passed: true,
      tennisOnlyInCemara: true,
      customerAndAdminCheckoutBlockedOutsideCemara: true,
      courtCreationBlockedOutsideCemara: true,
      existingBookingsPreserved: true,
    }),
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
