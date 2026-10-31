import { beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import * as XLSX from 'xlsx'
const mocks = vi.hoisted(() => ({ report: vi.fn() }))
vi.mock('@/services/court-performance.service', () => ({
  getCourtPerformance: mocks.report,
}))
import {
  courtPerformanceHandler,
  courtPerformanceExportHandler,
  performanceQuery,
} from './court-performance.handler'
function app(role = 'ADMIN') {
  const a = new Hono<any>()
  a.use('*', async (c, next) => {
    c.set('admin', { id: 'staff', role })
    await next()
  })
  a.get('/report', ...courtPerformanceHandler)
  a.get('/export', ...courtPerformanceExportHandler)
  return a
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.report.mockResolvedValue({
    summary: { hours: 1 },
    courtSummary: [],
    categories: [],
    rows: [],
  })
})
it.each(['ADMIN', 'SUPER_ADMIN', 'ADMIN_VIEWER'])(
  'allows %s to read and passes playing date and court filters',
  async (role) => {
    const r = await app(role).request(
      '/report?startDate=2026-10-01&endDate=2026-10-31&courtId=c1',
    )
    expect(r.status).toBe(200)
    expect(mocks.report).toHaveBeenCalledWith('2026-10-01', '2026-10-31', 'c1')
  },
)
it('rejects cashier access before querying revenue', async () => {
  expect(
    (
      await app('CASHIER').request(
        '/report?startDate=2026-10-01&endDate=2026-10-31',
      )
    ).status,
  ).toBe(403)
  expect(mocks.report).not.toHaveBeenCalled()
})
it.each([
  { startDate: '2026-02-30', endDate: '2026-03-01' },
  { startDate: '2026-10-31', endDate: '2026-10-01' },
  { startDate: '2025-01-01', endDate: '2026-10-01' },
])('validates calendar dates, order and bounded report length: %j', (q) => {
  expect(performanceQuery.safeParse(q).success).toBe(false)
})
it('exports a readable Excel workbook using exactly the same report filters', async () => {
  const res = await app().request(
    '/export?startDate=2026-10-01&endDate=2026-10-31&courtId=c1',
  )
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('spreadsheetml')
  const wb = XLSX.read(await res.arrayBuffer(), { type: 'array' })
  expect(wb.SheetNames).toEqual([
    'Ringkasan',
    'Per cabang',
    'Per lapangan',
    'Kategori',
    'Detail booking',
    'Definisi',
  ])
  expect(mocks.report).toHaveBeenCalledWith('2026-10-01', '2026-10-31', 'c1')
})
