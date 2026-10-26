import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
const url = process.env.TEST_BRANCH_DATABASE_URL
vi.mock('@/services/xendit.service', () => ({
  xenditService: {
    createPaymentRequestV3: vi.fn(() => {
      throw new Error('Gateway must not be used')
    }),
    createPaymentSession: vi.fn(() => {
      throw new Error('Gateway must not be used')
    }),
  },
}))
vi.mock('@/services/midtrans.service', () => ({
  midtransService: {
    charge: vi.fn(() => {
      throw new Error('Gateway must not be used')
    }),
  },
}))
const run = url ? describe : describe.skip
run('branch booking HTTP integration', () => {
  const raw = new PrismaClient({ datasourceUrl: url })
  const prefix = `http-branches-${Date.now()}`
  const a = `${prefix}-a`,
    b = `${prefix}-b`,
    userId = `${prefix}-user`,
    wallet = `${prefix}-wallet`,
    membershipId = `${prefix}-membership`
  let app: (typeof import('@/app'))['default']
  let token: string, staffToken: string, superToken: string
  const headers = (branchId: string, auth = token) => ({
    'Content-Type': 'application/json',
    'X-Branch-ID': branchId,
    Authorization: `Bearer ${auth}`,
  })
  beforeAll(async () => {
    process.env.DATABASE_URL = url!
    app = (await import('@/app')).default
    const { generateJwtToken } = await import('@/lib/token')
    token = await generateJwtToken({ id: userId, phone: '+628000000' })
    staffToken = await generateJwtToken({
      id: `${prefix}-staff`,
      role: 'ADMIN',
      email: `${prefix}@test.invalid`,
    })
    superToken = await generateJwtToken({
      id: `${prefix}-super`,
      role: 'SUPER_ADMIN',
      email: `${prefix}-super@test.invalid`,
    })
    await raw.branch.createMany({
      data: [a, b].map((id) => ({ id, name: id, address: 'Test location' })),
    })
    await raw.user.create({
      data: { id: userId, name: 'HTTP Test', phone: `+63${Date.now()}` },
    })
    await raw.staff.createMany({
      data: [
        {
          id: `${prefix}-staff`,
          branchId: a,
          name: 'Staff A',
          email: `${prefix}@test.invalid`,
          password: 'unused',
          role: 'ADMIN',
        },
        {
          id: `${prefix}-super`,
          branchId: a,
          name: 'Super Admin',
          email: `${prefix}-super@test.invalid`,
          password: 'unused',
          role: 'SUPER_ADMIN',
        },
      ],
    })
    for (const id of [a, b]) {
      await raw.court.create({
        data: { id: `${id}-court`, branchId: id, name: `${id} Court` },
      })
      await raw.slot.create({
        data: {
          id: `${id}-slot`,
          branchId: id,
          courtId: `${id}-court`,
          type: 'COURT',
          price: 200000,
          startAt: new Date('2035-10-23T08:00:00Z'),
          endAt: new Date('2035-10-23T09:00:00Z'),
        },
      })
    }
    await raw.membership.create({
      data: {
        id: membershipId,
        name: membershipId,
        price: 100,
        sessions: 10,
        duration: 30,
        branches: { create: [a, b].map((branchId) => ({ branchId })) },
      },
    })
    await raw.membershipUser.create({
      data: {
        id: wallet,
        membershipId,
        userId,
        remainingSessions: 10,
        remainingDuration: 30,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2036-01-01'),
      },
    })
    await raw.invoice.create({
      data: {
        id: `${prefix}-sale`,
        userId,
        membershipUserId: wallet,
        branchId: a,
        number: `${prefix}-sale`,
        subtotal: 100,
        total: 100,
        status: 'PAID',
        dueDate: new Date(),
        paidAt: new Date(),
      },
    })
  })
  afterAll(async () => {
    await raw.invoice.deleteMany({ where: { userId } })
    await raw.bookingDetail.deleteMany({ where: { booking: { userId } } })
    await raw.booking.deleteMany({ where: { userId } })
    await raw.membershipUser.deleteMany({ where: { userId } })
    await raw.membership.deleteMany({ where: { id: membershipId } })
    await raw.notification.deleteMany({ where: { branchId: { in: [a, b] } } })
    await raw.slot.deleteMany({ where: { branchId: { in: [a, b] } } })
    await raw.court.deleteMany({ where: { branchId: { in: [a, b] } } })
    await raw.staff.deleteMany({
      where: { id: { in: [`${prefix}-staff`, `${prefix}-super`] } },
    })
    await raw.user.deleteMany({ where: { id: userId } })
    await raw.branch.deleteMany({ where: { id: { in: [a, b] } } })
    await raw.$disconnect()
    await (await import('@/lib/prisma')).db.$disconnect()
  })
  it('rejects a cart containing court slots from two branches without consuming hours', async () => {
    const response = await app.request('/checkout', {
      method: 'POST',
      headers: headers(b),
      body: JSON.stringify({
        courtSlots: [`${a}-slot`, `${b}-slot`],
        useMembership: true,
      }),
    })
    expect(response.status).toBe(400)
    expect(
      (await raw.membershipUser.findUniqueOrThrow({ where: { id: wallet } }))
        .remainingSessions,
    ).toBe(10)
    expect(await raw.booking.count({ where: { userId } })).toBe(0)
  })
  it('pays a booking in branch B from a membership sold at branch A', async () => {
    const response = await app.request('/checkout', {
      method: 'POST',
      headers: headers(b),
      body: JSON.stringify({ courtSlots: [`${b}-slot`], useMembership: true }),
    })
    const result = (await response.json()) as {
      success: boolean
      data: { invoiceId: string }
    }
    expect(result, JSON.stringify(result)).toMatchObject({
      success: true,
      data: { status: 'CONFIRMED', paymentStatus: 'PAID', total: 0 },
    })
    const invoice = await raw.invoice.findUniqueOrThrow({
      where: { id: result.data.invoiceId },
      include: { booking: true },
    })
    expect(invoice.branchId).toBe(b)
    expect(invoice.booking?.branchId).toBe(b)
    expect(invoice.dueDate).toEqual(invoice.paidAt)
    expect(
      (await raw.membershipUser.findUniqueOrThrow({ where: { id: wallet } }))
        .remainingSessions,
    ).toBe(9)
  })
  it('blocks staff from changing branch headers and accessing another branch resource by ID', async () => {
    expect(
      (
        await app.request(`/admin/courts/${b}-court`, {
          headers: headers(b, staffToken),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(`/admin/courts/${b}-court`, {
          headers: headers(a, staffToken),
        })
      ).status,
    ).toBe(404)
  })
  it('lets super admin inspect either branch and keeps client invoice history cross-branch', async () => {
    expect(
      (
        await app.request(`/admin/courts/${b}-court`, {
          headers: headers(b, superToken),
        })
      ).status,
    ).toBe(200)
    const detail = await app.request(`/invoices/${prefix}-sale`, {
      headers: headers(b),
    })
    expect(detail.status).toBe(200)
    expect(
      ((await detail.json()) as { data: { branch: { id: string } } }).data
        .branch.id,
    ).toBe(a)
  })
})
