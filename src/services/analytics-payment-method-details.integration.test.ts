import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/prisma'
import { withBranchContext } from '@/lib/branch-context'
import { getPaymentMethodAnalytics } from './analytics.service'

const run =
  process.env.RUN_PAYMENT_ANALYTICS_DB_TESTS === '1' ? describe : describe.skip
run('payment method invoice details in PostgreSQL', () => {
  const prefix = `payment-report-${Date.now()}`
  const branchId = `${prefix}-branch`,
    otherBranch = `${prefix}-other`,
    userId = `${prefix}-user`,
    methodId = `${prefix}-method`
  const start = new Date('2026-11-05T17:00:00Z'),
    end = new Date('2026-11-06T16:59:59.999Z')
  const scoped = <T>(callback: () => T, selectedBranch = branchId) =>
    withBranchContext(
      { branchId: selectedBranch, isAdmin: true, isSuperAdmin: true },
      callback,
    )
  beforeAll(async () => {
    await db.branch.createMany({
      data: [branchId, otherBranch].map((id) => ({
        id,
        name: id,
        address: 'Test only',
      })),
    })
    await db.user.create({ data: { id: userId, name: prefix, phone: prefix } })
    await db.paymentMethod.create({
      data: { id: methodId, name: prefix, isOffline: true },
    })
    for (const [name, status, paidAt] of [
      ['paid', 'PAID', new Date('2026-11-06T01:00:00Z')],
      ['refunded', 'REFUNDED', new Date('2026-11-06T01:00:00Z')],
      ['outside', 'PAID', new Date('2026-11-04T01:00:00Z')],
    ] as const) {
      await db.payment.create({
        data: {
          id: `${prefix}-${name}-payment`,
          paymentMethodId: methodId,
          status: 'PAID',
          amount: 102000,
          paidAt,
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
      })
      await db.invoice.create({
        data: {
          id: `${prefix}-${name}-invoice`,
          branchId,
          userId,
          number: `${prefix}-${name}`,
          paymentId: `${prefix}-${name}-payment`,
          status,
          paidAt,
          dueDate: end,
          subtotal: 100000,
          total: 102000,
          processingFee: 2000,
        },
      })
    }
  })
  afterAll(async () => {
    await db.invoice.deleteMany({ where: { id: { startsWith: prefix } } })
    await db.payment.deleteMany({ where: { id: { startsWith: prefix } } })
    await db.paymentMethod.deleteMany({ where: { id: methodId } })
    await db.user.deleteMany({ where: { id: userId } })
    await db.branch.deleteMany({
      where: { id: { in: [branchId, otherBranch] } },
    })
  })
  it('includes only paid invoices in the selected payment period and reconciles card totals', async () => {
    const report = await scoped(() => getPaymentMethodAnalytics(start, end))
    expect(report.summary).toEqual({
      totalAmount: 102000,
      totalProcessingFees: 2000,
      totalTransactions: 1,
      methodCount: 1,
    })
    expect(report.methods[0].transactions).toHaveLength(1)
    expect(report.methods[0].transactions[0]).toMatchObject({
      id: `${prefix}-paid-invoice`,
      invoiceNumber: `${prefix}-paid`,
      customerName: prefix,
      paymentMethod: prefix,
      netAmount: 100000,
    })
  })
  it('does not disclose invoices from a different branch', async () => {
    const report = await scoped(
      () => getPaymentMethodAnalytics(start, end),
      otherBranch,
    )
    expect(report.summary.totalTransactions).toBe(0)
    expect(report.methods).toEqual([])
  })
})
