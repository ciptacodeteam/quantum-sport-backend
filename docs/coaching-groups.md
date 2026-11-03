# Grup Coaching (admin)

Grup adalah brand bersama lintas cabang. Super Admin mengelola nama, logo (URL), deskripsi, olahraga, cabang layanan dan status melalui **Master Data → Grup Coaching**. Admin dapat membaca grup dan mengatur keanggotaan coach di cabangnya melalui **Master Data → Coaching → Edit profil**. Coach dapat mempunyai beberapa grup; tanpa keanggotaan, coach diperlakukan sebagai Coach Independen. Ballboy tidak masuk grup.

Di Schedule, buka booking terkonfirmasi lalu **Tambah Coach → Grup coaching → Coach**. Pilihan mengikuti cabang, olahraga, satu jam di dalam booking lapangan, dan ketersediaan coach. Ballboy dapat dipilih bersamaan untuk Tennis. Harga, pembayaran, penahanan slot dan batas waktu booking tetap mengikuti aturan layanan yang ada. Grup tidak tampil sebagai pilihan pada alur booking pelanggan.

Setiap layanan coach menyimpan `coachingGroupId` dan snapshot `coachingGroupName`. Perubahan nama/anggota/status grup tidak mengganti riwayat booking. Ganti/batalkan coach tetap khusus Super Admin. Penggantian coach dapat memilih grup lain dengan jadwal, olahraga, cabang dan harga yang sama; perubahan grup dicatat bersama penggantian. Pembatalan atau penonaktifan grup tidak otomatis membatalkan booking.

## Persiapan database sebelum deploy backend

Jalankan pada database aplikasi yang dituju:

```sh
bun run db:coaching-groups
bun run db:generate
```

`prisma/coaching-groups.sql` bersifat additive dan dapat diulang. Coach dan booking lama tetap independen. Terapkan SQL sebelum backend yang membaca relasi baru dijalankan. Tidak ada migrasi produksi otomatis dalam perubahan ini.

## Pengujian transaksi

Gunakan database pengujian khusus dengan schema terbaru, bukan database produksi:

```sh
TEST_COACHING_DATABASE_URL=postgresql://... bun run test src/services/coaching.integration.test.ts
```

Pengujian mencakup pemilihan grup, validasi keanggotaan/olahraga/status, riwayat nama grup, penggantian antar grup, dan pencegahan booking coach yang sama melalui grup lain.
