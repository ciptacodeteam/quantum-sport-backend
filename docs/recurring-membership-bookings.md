# Booking rutin membership (admin)

Di Booking Lapangan, tambahkan lapangan/jam pada tanggal awal, lalu pilih Ulangi
mingguan. Pilih hari bermain dan salah satu periode:

- Ikuti rolling window: tidak memiliki tanggal berhenti; terus menambahkan sesi.
- Durasi 1–12 bulan: akhir dihitung dari tanggal awal dengan bulan kalender. Seluruh tanggal dalam rentang dibuat langsung saat checkout, termasuk di luar rolling window publik.
- Sampai tanggal tertentu: admin memilih akhir rentang (maksimal 12 bulan dari jadwal awal). Seluruh pengulangan dalam rentang dibuat langsung.

Pratinjau untuk durasi/tanggal tetap tidak dibatasi jadwal yang sudah terbit. Kalender booking biasa tetap mengikuti rolling window. Pengaturan hari/jam operasional, bulk nonaktifkan, tarif efektif, dan konflik booking tetap diperiksa. Semua lapangan harus memiliki rolling window aktif; membuat slot yang belum terbit membutuhkan konfigurasi harga/jadwal otomatis lengkap. Aturan lama tanpa metadata tersebut tetap bisa memakai slot manual yang sudah terbit. Admin meninjau dan menyetujui sesi yang dilewati.
Pratinjau hanya membaca data dan tidak menerbitkan/menahan slot. Keranjang menyimpan jadwal awal saja. Saat checkout, setiap tanggal bermain mendapat booking dan invoice tersendiri (termasuk tanggal pratinjau yang sudah ada dalam keranjang versi lama). Pengulangan tidak digabung dalam satu invoice. Konflik baru membatalkan seluruh checkout kecuali admin telah menyetujui untuk melewati sesi bentrok. Perubahan ini berlaku untuk booking baru, bukan pemecahan otomatis invoice historis. Pelanggan harus memiliki membership berbayar yang cocok
olahraga/jamnya dan masih dalam masa berlaku saat checkout awal. Tidak ada syarat
saldo mencukupi untuk booking rutin. Booking biasa mempertahankan perilaku lama.

Semua tanggal dan jam memakai Asia/Jakarta (WIB). Misalnya 19.00 WIB disimpan sebagai 12.00 UTC; slot kedua 20.00 WIB memiliki waktu potong sendiri. Setiap slot booking rutin memotong saldo membership asal ketika jam mulai tiba,
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

Saldo minus ditampilkan di Kelola Pemesanan → Tunggakan Value Pack, termasuk paket yang sudah kedaluwarsa. Invoice sesi membership tetap Rp0; pengulangan tidak menagih uang otomatis.

## Penerapan

Pembaruan rentang mingguan dan invoice terpisah tidak memerlukan migrasi tambahan; memakai tabel recurring/ledger yang sama. Deploy frontend, backend, dan scheduler versi baru bersama.

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
