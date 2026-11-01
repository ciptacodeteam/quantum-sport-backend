# Coach dan Ballboy untuk admin

## Deploy

Deploy backend sebelum frontend karena halaman baru memerlukan endpoint dan kolom baru.
Docker entrypoint menjalankan `prisma/coaching-admin.sql` otomatis. Untuk deploy non-Docker:

```sh
bun run db:coaching-admin
bun run db:generate
bun run build
```

Gunakan DATABASE_URL deployment yang sesuai. Migrasi bersifat additive dan dapat dijalankan berulang; tidak menggeser timestamp atau mengubah invoice lama.

## Penggunaan

1. Pilih satu cabang, buka Master Data → Coaching atau Ballboy, lalu tambahkan profil.
2. Buka Jadwal & Harga, tentukan tanggal, hari, jam, dan harga per jam (WIB). Slot terisi atau ditutup tidak ditimpa.
3. Di Schedule, klik booking lapangan yang terkonfirmasi pada jam yang diinginkan.
4. Pilih coach sesuai olahraga, atau ballboy untuk tennis, serta metode pembayaran. Klik **Tambah layanan & buat invoice**.
5. Invoice layanan dibuat terpisah dan dapat dibuka/disalin dari dialog maupun Kelola Pemesanan → Coach / Ballboy. Invoice lapangan tetap utuh.

Layanan berbayar memakai pembayaran Midtrans yang sudah tersedia. Invoice berstatus menunggu pembayaran, slot staf ditahan 10 menit, lalu dikonfirmasi melalui rekonsiliasi gateway. Tidak ada konfirmasi lunas oleh admin. Layanan harga nol langsung dikonfirmasi dengan invoice nol tanpa pembayaran gateway.

Profil ini hanya untuk layanan admin, bukan akun login staf. Profil baru disembunyikan dari katalog/availability pengguna. Pengguna tetap tidak bisa checkout add-on.

Pemesanan memakai batas 15 menit sesudah jam mulai. Staf yang sama tidak bisa dipesan untuk jam bertumpuk, termasuk melalui checkout lama dan pembayaran terlambat. Ballboy dibatasi satu orang per interval lapangan tennis.

## Verifikasi

```sh
bun run typecheck
bun run test
TEST_COACHING_DATABASE_URL='postgresql://.../database_test' bun run test -- src/services/coaching.integration.test.ts
```

Gunakan database test yang sudah memakai schema terbaru. Uji integrasi membuat dan membersihkan data dengan prefix khusus; gateway dimock agar tidak membuat tagihan sungguhan.
