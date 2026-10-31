# Booking rutin membership (admin)

Di Booking Lapangan, tambahkan lapangan/jam pada tanggal awal, lalu pilih Ulangi
mingguan. Pilih hari bermain dan salah satu periode:

- Ikuti rolling window: tidak memiliki tanggal berhenti; terus menambahkan sesi.
- Durasi 1–12 bulan: akhir dihitung dari tanggal awal dengan bulan kalender.
  Jadwal di luar window baru dibuat saat rolling membukanya.

Pratinjau dibatasi window terpendek lapangan yang dipilih. Semua lapangan harus
memiliki rolling window aktif. Admin meninjau dan menyetujui sesi yang dilewati.
Aturan disimpan dalam transaksi checkout awal; pratinjau saja tidak mengaktifkan
aturan atau menahan slot. Pelanggan harus memiliki membership berbayar yang cocok
olahraga/jamnya dan masih dalam masa berlaku saat checkout awal. Tidak ada syarat
saldo mencukupi untuk booking rutin. Booking biasa mempertahankan perilaku lama.

Setiap slot booking rutin memotong saldo membership asal ketika jam mulai tiba,
bukan ketika checkout. Satu jam lapangan = satu sesi. Scheduler berjalan setiap
menit sehingga pemotongan terjadi pada pemeriksaan pertama sejak jam mulai.
Akses daftar slot juga menjalankan proses ini. Ledger unik per detail booking
mencegah pemotongan ganda ketika worker berjalan bersamaan atau mengulang proses.
Saldo dapat menjadi negatif. Membership yang telah melewati akhir masa berlaku
atau memiliki saldo nol/minus tidak menghentikan aturan yang sudah aktif.
Setelah pembelian paket baru pada olahraga yang sama berhasil dibayar, saldo minus
dipindahkan ke paket baru dan aturan rutin melanjutkan pemotongan di paket tersebut.
Riwayat pemakaian lama tetap tersimpan. Lihat membership-renewal.md.

Saat rolling maju, setiap tanggal baru mendapat booking tersendiri dengan invoice
nol karena ditanggung membership. Saldo tetap belum dipotong sebelum slot mulai.
Add-on tidak diulang dan tidak ada penagihan uang otomatis. Membership yang
ditangguhkan atau lapangan/cabang nonaktif menghentikan sementara penambahan
jadwal. Jika satu slot sesi bentrok, seluruh sesi dilewati dan alasan tercatat;
sistem tidak merebut slot atau mengulang sesi yang sengaja dibatalkan.

Admin dapat membuka Kelola booking rutin membership untuk melihat aturan dan
sesi yang dilewati, serta menghentikan penambahan jadwal. Booking yang sudah
dibentuk tetap berlaku dan harus dibatalkan secara terpisah bila diperlukan.
Pembatalan sebelum jam mulai tidak mengurangi kuota; pembatalan admin setelah
pemotongan mengikuti mekanisme pengembalian kuota yang sudah ada.

Filter Saldo minus tersedia di Kelola Pemesanan Value Pack dan export Excel,
termasuk paket yang telah kedaluwarsa.

## Penerapan

Sebelum memulai backend/worker versi baru, jalankan pada database tujuan:

```sh
bun run db:rolling-booking-window
bun run db:recurring-bookings
bun run db:membership-renewal
bun run db:generate
```

SQL menambahkan tabel tanpa menghapus data. Pada Docker dev, setiap service
memiliki volume node_modules terpisah; jalankan db:generate di app, scheduler-worker,
dan email-worker, lalu restart service tersebut. Database lokal sudah diperbarui.
Production harus menerapkan SQL yang sama dan membangun image dengan client baru.

## Verifikasi

```sh
bun run typecheck
bun run test
RUN_RECURRING_DB_TESTS=1 node --import dotenv/config node_modules/vitest/vitest.mjs run src/services/recurring-booking.integration.test.ts
```

Tes database memakai fixture berawalan recurring-test- dan membersihkannya.
Jalankan hanya pada database pengembangan. Tes mencakup jam mulai, saldo minus,
konkurensi, expiry membership, konflik, window maju, durasi bulanan dan stop.
