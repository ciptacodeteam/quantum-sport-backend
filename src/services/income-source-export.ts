import * as XLSX from 'xlsx'
import clubTime from '@/lib/club-time'
import type { getIncomeBySourceAnalytics } from './analytics.service'

type IncomeReport = Awaited<ReturnType<typeof getIncomeBySourceAnalytics>>
const labels: Record<string, string> = {
  Online: 'Online Booking',
  Cashier: 'Cashier Booking',
  Membership: 'Membership',
  InHouse: 'Paket Coach In-house',
  'Class Bookings': 'Transaksi kelas',
  Other: 'Belum terkelompok',
}
const timestamp = (value: string | Date | null | undefined) =>
  value ? clubTime(value).format('DD/MM/YYYY HH:mm') : ''
const cancellationLabels = {
  NONE: 'Tidak dibatalkan',
  PARTIAL: 'Sebagian dibatalkan',
  CANCELLED: 'Dibatalkan',
}

/** Use the same paid invoices and cancellation allocation as the on-screen report. */
export function createIncomeSourceWorkbook(report: IncomeReport) {
  const book = XLSX.utils.book_new()
  const sources = new Map<string, number[]>()
  for (const source of Object.keys(labels)) sources.set(source, [0, 0, 0, 0, 0])
  for (const row of report.transactions) {
    const totals = sources.get(row.source) ?? [0, 0, 0, 0, 0]
    totals[0]++
    totals[1] += row.amount
    totals[2] += row.processingFee
    totals[3] += row.excludedAmount
    totals[4] += row.netAmount
    sources.set(row.source, totals)
  }
  const summary = report.summary
  const summaryRows = [
    ['Income by Source'],
    [
      'Periode pembayaran (WIB)',
      timestamp(report.dateRange.startDate),
      timestamp(report.dateRange.endDate),
    ],
    [
      'Revenue = pembayaran pelanggan − biaya proses − nominal dibatalkan. Belum dikurangi biaya operasional.',
    ],
    [],
    [
      'Sumber',
      'Jumlah transaksi',
      'Pembayaran pelanggan',
      'Biaya proses',
      'Dikeluarkan karena dibatalkan',
      'Revenue',
    ],
    ...[...sources].map(([source, totals]) => [
      labels[source] ?? source,
      ...totals,
    ]),
    [
      'Total',
      summary.totalTransactions,
      summary.totalGrossAmount,
      summary.totalProcessingFees,
      summary.totalExcludedAmount,
      summary.totalNetAmount,
    ],
  ]
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
  summarySheet['!cols'] = [34, 23, 24, 22, 32, 24].map((wch) => ({ wch }))
  summarySheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
  ]
  summarySheet['!autofilter'] = { ref: `A5:F${summaryRows.length - 1}` }
  for (let r = 5; r < summaryRows.length; r++) {
    for (let c = 2; c <= 5; c++) {
      summarySheet[XLSX.utils.encode_cell({ r, c })].z =
        '"Rp" #,##0;[Red]("Rp" #,##0)'
    }
  }
  XLSX.utils.book_append_sheet(book, summarySheet, 'Ringkasan per sumber')
  const headers = [
    'Invoice',
    'Pemesanan',
    'Dibayar (WIB)',
    'Pelanggan',
    'Cabang',
    'Sumber',
    'Metode pembayaran',
    'Status pembayaran',
    'Status pemesanan',
    'Pembatalan',
    'Pembayaran pelanggan',
    'Biaya proses',
    'Dikeluarkan karena dibatalkan',
    'Revenue',
    'Jadwal bermain (WIB)',
    'Layanan dibatalkan',
  ]
  const transactionRows = report.transactions.map((row) => [
    row.invoiceNumber,
    row.bookingId ?? '',
    timestamp(row.paidAt),
    row.customerName,
    row.branchName,
    labels[row.source] ?? row.source,
    row.paymentMethod ?? '',
    row.paymentStatus,
    row.bookingStatus ?? '',
    cancellationLabels[row.cancellationStatus],
    row.amount,
    row.processingFee,
    row.excludedAmount,
    row.netAmount,
    row.playingSchedules
      .map(
        (slot) =>
          `${slot.label}: ${timestamp(slot.startAt)} – ${timestamp(slot.endAt)}`,
      )
      .join('\n'),
    row.cancelledServices
      .map(
        (service) =>
          `${service.kind} ${service.name} · Rp ${service.amount.toLocaleString('id-ID')}${service.reason ? ` · ${service.reason}` : ''}`,
      )
      .join('\n'),
  ])
  const details = XLSX.utils.aoa_to_sheet([headers, ...transactionRows])
  details['!cols'] = [
    25, 28, 23, 30, 22, 26, 23, 21, 21, 24, 24, 21, 32, 24, 65, 65,
  ].map((wch) => ({ wch }))
  details['!autofilter'] = {
    ref: `A1:P${Math.max(1, transactionRows.length + 1)}`,
  }
  for (let r = 1; r <= transactionRows.length; r++) {
    for (let c = 10; c <= 13; c++)
      details[XLSX.utils.encode_cell({ r, c })].z =
        '"Rp" #,##0;[Red]("Rp" #,##0)'
  }
  XLSX.utils.book_append_sheet(book, details, 'Detail transaksi')
  return book
}
