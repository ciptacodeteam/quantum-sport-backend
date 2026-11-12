import { beforeEach, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
const mocks = vi.hoisted(() => ({ report: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: {} }))
vi.mock('@/services/analytics.service', () => ({
  getIncomeBySourceAnalytics: mocks.report,
  getPaymentMethodAnalytics: vi.fn(),
  exportDataToExcel: vi.fn(),
  getBusinessAnalytics: vi.fn(),
}))
import { createRouter } from '@/lib/create-app'
import { exportIncomeBySourceHandler } from './analytics.handler'
const app = createRouter().get(
  '/income-by-source/export',
  ...exportIncomeBySourceHandler,
)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.report.mockImplementation(async (startDate, endDate) => ({
    dateRange: { startDate, endDate },
    transactions: [],
    bySource: {},
    summary: {
      totalTransactions: 0,
      totalGrossAmount: 0,
      totalProcessingFees: 0,
      totalExcludedAmount: 0,
      totalNetAmount: 0,
    },
  }))
})
it('downloads xlsx using exactly the requested date range and source', async () => {
  const startDate = '2026-11-11T17:00:00.000Z'
  const endDate = '2026-11-12T16:59:59.999Z'
  const query = new URLSearchParams({ startDate, endDate, source: 'cashier' })
  const response = await app.request(`/income-by-source/export?${query}`)
  expect(response.status).toBe(200)
  expect(mocks.report).toHaveBeenCalledWith(
    new Date(startDate),
    new Date(endDate),
    'cashier',
  )
  expect(response.headers.get('Content-Type')).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  expect(response.headers.get('Content-Disposition')).toBe(
    'attachment; filename="income-by-source-2026-11-12-2026-11-12.xlsx"',
  )
  const book = XLSX.read(await response.arrayBuffer(), { type: 'array' })
  expect(book.SheetNames).toEqual([
    'Ringkasan per sumber',
    'Revenue per layanan',
    'Detail transaksi',
  ])
})
it('rejects invalid date filters before loading report data', async () => {
  const response = await app.request(
    '/income-by-source/export?startDate=invalid',
  )
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(response.status).toBeLessThan(500)
  expect(mocks.report).not.toHaveBeenCalled()
})
