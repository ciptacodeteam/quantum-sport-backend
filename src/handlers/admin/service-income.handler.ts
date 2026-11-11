import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { factory } from '@/lib/create-app'
import { validateHook } from '@/helpers/validate-hook'
import { requireAnyAdminRole } from '@/middlewares/auth'
import { ok } from '@/lib/response'
import clubTime from '@/lib/club-time'
import { getServiceIncome } from '@/services/service-income.service'
import * as XLSX from 'xlsx'

export const serviceIncomeQuery = z
  .object({
    startDate: z.iso.datetime(),
    endDate: z.iso.datetime(),
    clubId: z.string().min(1).max(200).optional(),
    staffId: z.string().min(1).max(200).optional(),
    service: z.enum(['COACH', 'BALLBOY']).optional(),
  })
  .refine((q) => {
    const days = (+new Date(q.endDate) - +new Date(q.startDate)) / 86400000
    return days >= 0 && days <= 366
  }, 'Tanggal akhir harus setelah tanggal mulai dan periode maksimal 366 hari.')

const permissions = requireAnyAdminRole(['ADMIN', 'ADMIN_VIEWER'])
export const serviceIncomeHandler = factory.createHandlers(
  permissions,
  zValidator('query', serviceIncomeQuery, validateHook),
  async (c) => {
    const q = c.req.valid('query')
    return c.json(
      ok(await getServiceIncome(new Date(q.startDate), new Date(q.endDate), q)),
    )
  },
)

export const serviceIncomeExportHandler = factory.createHandlers(
  permissions,
  zValidator('query', serviceIncomeQuery, validateHook),
  async (c) => {
    const q = c.req.valid('query')
    const report = await getServiceIncome(
      new Date(q.startDate),
      new Date(q.endDate),
      q,
    )
    const book = XLSX.utils.book_new()
    const append = (name: string, rows: object[]) =>
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), name)
    append('Ringkasan', [
      {
        'Mulai (WIB)': clubTime(q.startDate).format('DD/MM/YYYY HH:mm'),
        'Sampai (WIB)': clubTime(q.endDate).format('DD/MM/YYYY HH:mm'),
        'Hak coach': report.summary.coachAmount,
        'Hak ballboy': report.summary.ballboyAmount,
        'Total hak club': report.summary.totalAmount,
        'Belum terhubung club': report.summary.unassignedAmount,
        'Invoice lunas': report.summary.invoiceCount,
      },
    ])
    append(
      'Per club',
      report.clubs.map((row) => ({
        Club: row.name,
        Coach: row.coachAmount,
        Ballboy: row.ballboyAmount,
        'Total hak': row.totalAmount,
        Sesi: row.sessions,
        Jam: row.hours,
      })),
    )
    append(
      'Per petugas',
      report.staff.map((row) => ({
        Nama: row.name,
        Jenis: row.service,
        Club: row.clubName,
        Sesi: row.sessions,
        Jam: row.hours,
        'Hak pendapatan': row.amount,
      })),
    )
    append(
      'Detail transaksi',
      report.rows.map((row) => ({
        Invoice: row.invoiceNumber,
        Pelanggan: row.customerName,
        Cabang: row.branchName,
        'Dibayar (WIB)': clubTime(row.paidAt).format('DD/MM/YYYY HH:mm'),
        Jenis: row.service,
        Nama: row.staffName,
        Club: row.clubName,
        'Mulai sesi (WIB)': row.startAt,
        'Selesai sesi (WIB)': row.endAt,
        'Biaya jasa': row.servicePrice,
        'Alokasi diskon': row.discount,
        'Hak club (100%)': row.amount,
      })),
    )
    append('Definisi', [
      {
        Keterangan:
          'Berdasarkan tanggal pembayaran WIB. Hanya invoice lunas, booking reguler terkonfirmasi dan jasa aktif. Hak 100% dari pembayaran jasa setelah alokasi promo; biaya lapangan dan biaya proses tidak termasuk. Potongan Coach Club hanya mengubah biaya lapangan, bukan tarif jasa. Coach in-house tidak termasuk hak club. Baris jasa batal dan invoice refund tidak dihitung. Club coach memakai catatan saat booking. Ballboy dan jasa tanpa catatan club masuk Tanpa Club. Coach yang sudah ditandai Lunas ke Club dikeluarkan dari seluruh rekap dan rincian tagihan. Penanda lunas dicatat manual oleh Admin atau Super Admin.',
      },
    ])
    c.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    c.header(
      'Content-Disposition',
      `attachment; filename="coach-ballboy-income-${clubTime(q.startDate).format('YYYY-MM-DD')}-${clubTime(q.endDate).format('YYYY-MM-DD')}.xlsx"`,
    )
    return c.body(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  },
)
