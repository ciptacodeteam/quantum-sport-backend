import { factory } from '@/lib/create-app'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { validateHook } from '@/helpers/validate-hook'
import { ok } from '@/lib/response'
import clubTime from '@/lib/club-time'
import { getCourtPerformance } from '@/services/court-performance.service'
import * as XLSX from 'xlsx'
import { requireAnyAdminRole } from '@/middlewares/auth'

export const performanceQuery = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    courtId: z.string().min(1).optional(),
  })
  .refine(
    (q) =>
      [q.startDate, q.endDate].every(
        (d) => clubTime(d).isValid() && clubTime(d).format('YYYY-MM-DD') === d,
      ),
    'Tanggal tidak valid.',
  )
  .refine(
    (q) =>
      clubTime(q.endDate).diff(clubTime(q.startDate), 'day') >= 0 &&
      clubTime(q.endDate).diff(clubTime(q.startDate), 'day') <= 365,
    'Periode maksimal 366 hari dan tanggal akhir harus setelah tanggal mulai.',
  )

export const courtPerformanceHandler = factory.createHandlers(
  requireAnyAdminRole(['ADMIN', 'ADMIN_VIEWER']),
  zValidator('query', performanceQuery, validateHook),
  async (c) => {
    const q = c.req.valid('query')
    return c.json(
      ok(await getCourtPerformance(q.startDate, q.endDate, q.courtId)),
    )
  },
)
export const courtPerformanceExportHandler = factory.createHandlers(
  requireAnyAdminRole(['ADMIN', 'ADMIN_VIEWER']),
  zValidator('query', performanceQuery, validateHook),
  async (c) => {
    const q = c.req.valid('query'),
      report = await getCourtPerformance(q.startDate, q.endDate, q.courtId)
    const book = XLSX.utils.book_new()
    const append = (name: string, rows: object[]) =>
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), name)
    append('Ringkasan', [
      { Dari: q.startDate, Sampai: q.endDate, ...report.summary },
    ])
    append('Per cabang', report.branchSummary ?? [])
    append('Per lapangan', report.courtSummary)
    append('Kategori', report.categories)
    append(
      'Detail booking',
      report.rows.map((r) => ({
        Customer: r.customer,
        Invoice: r.invoiceNumber,
        Lapangan: r.court,
        Cabang: r.branch,
        Kategori: r.category,
        'Tanggal main (WIB)': clubTime(r.startAt).format('DD/MM/YYYY'),
        Mulai: clubTime(r.startAt).format('HH:mm'),
        Selesai: clubTime(r.endAt).format('HH:mm'),
        'Jam dipesan': r.hours,
        'Jam berlalu': r.pastHours,
        'Jam mendatang': r.upcomingHours,
        'Harga normal': r.normalPrice,
        'Pembayaran lapangan': r.paidRevenue,
        'Alokasi Value Pack': r.membershipAllocation,
        'Nilai pemakaian': r.revenue,
        'Nilai berlalu': r.realizedRevenue,
        'Booking dibuat (WIB)': clubTime(r.createdAt).format(
          'DD/MM/YYYY HH:mm',
        ),
      })),
    )
    append('Definisi', [
      {
        Keterangan:
          'Berdasarkan tanggal main WIB, hanya booking confirmed. Pembayaran lapangan dibagi proporsional setelah promo, tidak termasuk biaya proses dan add-on. Value Pack dialokasikan dari harga pembelian dibayar per jam paket, bukan penerimaan kas baru. Complimentary adalah non-membership dengan nilai lapangan nol. Kapasitas adalah gabungan slot terbit tersedia dan slot confirmed; slot tutup tidak dihitung. Kapasitas belum terbit tidak diestimasi.',
      },
    ])
    c.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    c.header(
      'Content-Disposition',
      `attachment; filename="court-performance-${q.startDate}-${q.endDate}.xlsx"`,
    )
    return c.body(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  },
)
