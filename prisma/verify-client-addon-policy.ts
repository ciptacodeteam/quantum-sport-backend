import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  assert.equal(process.env.NODE_ENV, 'development')
  const report = JSON.parse(
    readFileSync('.backups/demo-data-report.json', 'utf8'),
  )
  const customer = await db.user.findUniqueOrThrow({
    where: { id: 'demo-customer-1' },
  })
  const before = await db.booking.count()
  const login = await fetch('http://localhost:8000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: customer.phone,
      password: report.dummyPassword,
    }),
  })
  assert.equal(login.status, 200)
  const auth = (await login.json()) as any
  assert(auth.data.token)
  let checks = 0
  for (const branch of ['cemara', 's-parman'])
    for (const path of ['/checkout', '/checkout/apply-promo'])
      for (const selection of [
        { inventories: [{ inventoryId: 'policy-test', quantity: 1 }] },
        { coachSlots: ['policy-test'] },
        {
          ballboySlots: [
            { slotId: 'policy-test', courtSlotId: 'policy-court' },
          ],
        },
      ]) {
        const response = await fetch(`http://localhost:8000${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.data.token}`,
            'X-Branch-ID': branch,
          },
          body: JSON.stringify({
            courtSlots: ['policy-court'],
            promoCode: 'POLICYTEST',
            ...selection,
          }),
        })
        assert.equal(response.status, 400)
        assert.match(
          JSON.stringify(await response.json()),
          /Add-ons hanya dapat dipesan melalui admin/,
        )
        checks++
      }
  assert.equal(await db.booking.count(), before)
  console.log(
    JSON.stringify({
      passed: true,
      blockedCustomerRequests: checks,
      bookingCountUnchanged: true,
    }),
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
