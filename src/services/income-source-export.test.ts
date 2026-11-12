import { beforeEach, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
const mocks = vi.hoisted(() => ({ invoices: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  db: { invoice: { findMany: mocks.invoices } },
}))
vi.mock('@/services/upload.service', () => ({ getFileUrl: vi.fn() }))
import { getIncomeBySourceAnalytics } from './analytics.service'
import { createIncomeSourceWorkbook } from './income-source-export'
const start = new Date('2026-11-11T17:00:00Z')
const end = new Date('2026-11-12T16:59:59.999Z')
const invoice = (id: string, total: number) => ({
  id,
  number: `INV-${id}`,
  branchId: 'cemara',
  branch: { name: 'Cemara' },
  user: { name: '=HYPERLINK("test")' },
  payment: { method: { name: 'QRIS' } },
  paidAt: new Date('2026-11-11T17:30:00Z'),
  total,
  processingFee: 0,
  status: 'PAID',
})
beforeEach(() => vi.clearAllMocks())
it('exports reconciled totals, cancellations, all invoice rows, numeric money and WIB dates into a real xlsx', async () => {
  mocks.invoices.mockResolvedValue([
    {
      ...invoice('online', 102000),
      processingFee: 2000,
      booking: { id: 'booking-1', cashierId: null },
    },
    {
      ...invoice('cancelled', 250000),
      status: 'CANCELLED',
      booking: { id: 'booking-2', cashierId: 'staff', status: 'CANCELLED' },
    },
    { ...invoice('membership', 300000), membershipUser: { id: 'pack-1' } },
    { ...invoice('inhouse', 500000), inHouseWallet: { id: 'wallet-1' } },
    invoice('other', 50000),
  ])
  const report = await getIncomeBySourceAnalytics(start, end)
  const book = createIncomeSourceWorkbook(report)
  const saved = XLSX.read(
    XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
    { type: 'buffer' },
  )
  expect(saved.SheetNames).toEqual([
    'Ringkasan per sumber',
    'Revenue per layanan',
    'Detail transaksi',
  ])
  const summary = XLSX.utils.sheet_to_json<any[]>(
    saved.Sheets['Ringkasan per sumber'],
    { header: 1 },
  )
  expect(summary[1]).toEqual([
    'Periode pembayaran (WIB)',
    '12/11/2026 00:00',
    '12/11/2026 23:59',
  ])
  expect(summary.at(-1)).toEqual(['Total', 5, 1202000, 2000, 250000, 950000])
  const sourceRows = summary.slice(5, -1)
  expect(sourceRows.reduce((sum, row) => sum + row[5], 0)).toBe(950000)
  expect(sourceRows.find((row) => row[0] === 'Cashier Booking')).toEqual([
    'Cashier Booking',
    1,
    250000,
    0,
    250000,
    0,
  ])
  const details = saved.Sheets['Detail transaksi']
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(details)
  expect(rows).toHaveLength(5)
  expect(rows[0]).toMatchObject({
    Invoice: 'INV-online',
    'Dibayar (WIB)': '12/11/2026 00:30',
    Pelanggan: '=HYPERLINK("test")',
    Revenue: 100000,
  })
  expect(rows[1]).toMatchObject({
    Pembatalan: 'Dibatalkan',
    Revenue: 0,
    'Dikeluarkan karena dibatalkan': 250000,
  })
  expect(details.K2.t).toBe('n')
  expect(details.D2.t).toBe('s')
  expect(details.D2.f).toBeUndefined()
  expect(mocks.invoices.mock.lastCall?.[0].where.paidAt).toEqual({
    gte: start,
    lte: end,
  })
})
it('exports a usable empty report with headers and zero totals', async () => {
  mocks.invoices.mockResolvedValue([])
  const report = await getIncomeBySourceAnalytics(start, end)
  const book = createIncomeSourceWorkbook(report)
  const rows = XLSX.utils.sheet_to_json<any[]>(
    book.Sheets['Ringkasan per sumber'],
    { header: 1 },
  )
  expect(rows.at(-1)).toEqual(['Total', 0, 0, 0, 0, 0])
  expect(book.Sheets['Detail transaksi'].A1.v).toBe('Invoice')
  expect(book.Sheets['Detail transaksi']['!autofilter']?.ref).toBe('A1:T1')
})
