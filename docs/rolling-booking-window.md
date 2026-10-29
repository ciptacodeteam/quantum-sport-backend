# Jadwal booking berjalan

Di admin, buka Kelola Lapangan → detail lapangan → Atur Jadwal Otomatis.
Atur 1–12 bulan ke depan, hari operasional, jam tutup, dan harga. Simpan mengganti
satu aturan mingguan lengkap untuk lapangan tersebut; pilih semua hari yang ingin
tersedia. Perubahan mulai berlaku pada slot mendatang. Booking yang sudah ada
mempertahankan ID slot, tanggal, dan harga.

Bulan dihitung sebagai bulan kalender menurut Asia/Jakarta, sampai akhir tanggal
batas (inklusif). Contoh: 31 Januari + 1 bulan = 28 Februari (29 saat tahun kabisat).
Slot pukul 23:00 pada tanggal terakhir berakhir pada 00:00 hari berikutnya.

Slot baru diisi oleh scheduler dan saat daftar slot diakses. Proses memakai kunci
baris per lapangan dan constraint unik court+startAt. Proses berulang tidak
menggandakan slot atau mengaktifkan kembali penutupan manual. Penutupan dari
aturan mingguan disimpan terpisah dari status penutupan manual. Booking di luar
batas ditolak saat checkout dan reschedule, termasuk jika ID slot dikirim langsung.

Lapangan lama tetap memakai slot yang sudah ada sampai admin menyimpan durasi;
aturan baru tidak ditebak dari harga atau tanggal lama. Aturan ini juga tersedia
untuk lapangan tenis, dan setiap lapangan serta cabang memiliki pengaturan sendiri.

## Penerapan

Jalankan pada database tujuan sebelum memulai backend versi baru:

```sh
bun run db:rolling-booking-window
bun run db:generate
```

SQL bersifat aditif dan bisa diulang; tidak menghapus slot atau booking.
Database lokal sudah diperbarui selama implementasi. Production harus menjalankan
langkah yang sama saat deploy. Scheduler yang sudah ada memakai proses expiry per
menit; akses daftar slot tetap mengisi tanggal baru jika scheduler sedang berhenti.

## Verifikasi

```sh
bun run typecheck
bun run test
RUN_ROLLING_DB_TESTS=1 node --import dotenv/config node_modules/vitest/vitest.mjs run src/services/rolling-court-schedule.integration.test.ts
```

Tes integrasi hanya aktif dengan flag eksplisit, memakai cabang/lapangan khusus
berawalan `rolling-test-`, lalu membersihkan data tes. Gunakan database pengembangan.
Frontend memakai `vitest run --globals` sesuai setup jest-dom yang tersedia.
