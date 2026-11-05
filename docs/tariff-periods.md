# Pengaturan jam tarif

Buka **Master Data → Pengaturan Jam Tarif** dan pilih satu cabang pada header.
Admin mengatur Happy Hour / Peak Hour per olahraga. Tennis tetap hanya tersedia
untuk Cemara. Waktu memakai Asia/Jakarta dan jam penuh (00:00–24:00), sesuai slot
lapangan satu jam. Kedua rentang harus bersebelahan, tanpa jeda/tumpang tindih;
urutan Happy/Peak boleh dibalik. Tanpa konfigurasi, fallback adalah Happy 06–15
dan Peak 15–24.

Setiap aturan mempunyai tanggal mulai berlaku. Aturan terbaru yang sudah berlaku
pada **tanggal bermain** dipakai untuk tanggal tersebut. Aturan yang terjadwal dapat
diedit melalui baris riwayatnya; menyimpan tanggal yang sama memperbarui aturan
pada tanggal itu. Perubahan sebelum hari ini ditolak. Riwayat lama tidak dihapus.

Simpan aturan memperbarui jadwal rolling dari tanggal efektif sampai horizon saat
ini, dan tanggal baru memakai aturan yang sama saat horizon maju. Harga dasar
masih berasal dari pengaturan lapangan; bulk pricing rolling tetap menang pada
rentang yang cocok. Slot yang mempunyai booking aktif dan penutupan manual tidak
mendapat harga baru. ID, waktu, harga booking, dan biaya invoice dipertahankan.
Di luar kedua rentang, slot rolling ditutup menggunakan `scheduleClosed` sehingga
penutupan mingguan tetap terpisah dari penutupan manual.

Lapangan lama tanpa konfigurasi rolling tidak ditebak harga dasarnya. Slot lama
tersebut tetap ada; saat jadwal harga lama disimpan kembali, periode baru dipakai.
Untuk perluasan otomatis gunakan Atur Jadwal Otomatis di detail lapangan.
Tarif staf (coach/ballboy) tetap merupakan pengaturan terpisah.

Value Pack memakai periode yang sama pada validasi checkout pelanggan, checkout
admin, reschedule, dan pembuatan sesi booking rutin baru. Seluruh durasi satu slot
harus berada di dalam rentang yang diizinkan. Sesi rutin yang sudah menjadi booking
tetap utuh; kejadian baru di luar jam paket dilewati. Nama tampilan `AFTER_HOUR`
disamakan menjadi **Peak Hour**, tanpa mengganti nilai enum/data paket lama.
Diskon paket lapangan+coach untuk Padel mengikuti band tanggal bermain; nominal
bundle dan kebijakan Tennis tidak berubah.

API baca tersedia bagi admin, viewer, dan kasir untuk perhitungan booking;
penyimpanan hanya bagi admin/super admin, dengan cabang dari konteks autentikasi.
Endpoint publik `/courts/tariff-periods` mengikuti pemilih cabang yang sama seperti
endpoint lapangan lainnya.

## Penerapan

Jalankan sebelum backend versi baru pada setiap database tujuan:

```sh
bun run db:tariff-periods
bun run db:generate
```

SQL hanya membuat tabel/index tambahan dan aman diulang. Database pengembangan
lokal sudah diperbarui selama implementasi. Restart backend setelah generate agar
Prisma menggunakan model dan cakupan cabang yang baru.

### Docker

Pada development, kode sumber di-bind-mount tetapi setiap container mempunyai
volume `node_modules` sendiri. Karena itu, perubahan schema Prisma harus diikuti
generate di setiap container yang mengakses database:

```sh
docker compose exec -T app bun run db:tariff-periods
docker compose exec -T app bun run db:generate
docker compose exec -T email-worker bun run db:generate
docker compose exec -T scheduler-worker bun run db:generate
docker compose restart app email-worker scheduler-worker
```

Ketiga container development lokal sudah diperbarui dan endpoint publik jam tarif
sudah diverifikasi merespons HTTP 200. Data booking dan volume database tetap ada.

Untuk production, build/pull image baru dan deploy menggunakan alur deployment
proyek. Prisma Client dibuat saat build; entrypoint image baru menjalankan SQL
`tariff-periods.sql` yang aditif sebelum aplikasi atau worker dimulai. Parameter
khusus Prisma seperti `schema` dibuang dari URL khusus `psql`. Production belum
di-deploy dari sesi ini; perubahan pada source saja tidak memperbarui image lama.

## Verifikasi

```sh
npx vitest run
RUN_TARIFF_DB_TESTS=1 node --import dotenv/config node_modules/vitest/vitest.mjs run src/services/tariff-period.integration.test.ts
```

Tes integrasi dibatasi ke PostgreSQL lokal. Data fixture menggunakan awalan unik
`tariff-test-` dan dibersihkan sesudah tes; tidak menulis aturan cabang bisnis.
Frontend menggunakan `npx vitest run --globals` sesuai setup jest-dom proyek.

## Potongan coaching khusus admin

Halaman Pengaturan Jam Tarif menyediakan `happyCoachDiscount` dan `peakCoachDiscount`, berupa rupiah per slot lapangan satu jam. Keduanya mengikuti cabang, olahraga, dan tanggal mulai berlaku aturan tarif. Nilai 0 menonaktifkan potongan; nilai negatif, pecahan, atau di atas 2147483647 ditolak.

Admin checkout menghitung nominal dari aturan server untuk tanggal bermain, hanya jika ada coach dengan awal dan akhir jam yang sama. Potongan maksimal sebesar harga lapangan yang dibayar, tidak mengurangi biaya coach, dan tidak ditumpuk dengan slot yang ditanggung membership. Detail lapangan, total booking, dan invoice menyimpan hasil potongan tersebut dalam transaksi yang sama. Booking lama tidak dihitung ulang.

Customer checkout dan promo customer tidak menerapkan potongan coaching. Permintaan add-on coach melalui API customer tetap ditolak oleh kebijakan checkout customer.

Jalankan migrasi tambahan sebelum memulai backend versi ini:

```sh
bun run db:admin-coaching-discounts
bun run db:generate
```

Nominal awal adalah 0. Admin perlu mengisi potongan yang diinginkan lalu menyimpan aturan jam tarif. Tanggal mulai berlaku mengikuti **tanggal bermain**.
