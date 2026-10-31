# Pembelian paket baru dan saldo minus

Pembelian membership baru yang berhasil dibayar menutup saldo minus dari paket
berbayar milik pelanggan yang sama dan olahraga yang sama. Kuota paket baru
dikurangi seluruh minus tersebut. Paket lama menjadi nol; jika paket baru belum
cukup, kekurangannya menjadi saldo negatif paket baru. Saldo positif paket lama
tetap ada dan tidak digabungkan. Masa berlaku paket baru mengikuti pembeliannya.

Contoh: saldo lama -2, paket baru 10 → saldo lama 0 dan paket baru 8.
Saldo lama -12, paket baru 10 → saldo lama 0 dan paket baru -2.
Paket tenis tidak melunasi minus padel, dan saldo pelanggan lain tidak tersentuh.

Proses berjalan di transaksi pembayaran yang sama untuk webhook/reconciliation,
pembelian paket melalui admin, dan persetujuan pembayaran admin. Checkout yang
belum dibayar tidak melunasi minus atau memindahkan aturan. Callback pembayaran
berulang tidak memotong kuota lagi atau mengulang masa berlaku paket.

Aturan rutin yang mengacu pada paket lama pindah ke paket baru, termasuk aturan
berhenti/selesai yang masih mempunyai booking mendatang. Status aktif, tanggal
bermain, tanggal akhir, dan keputusan berhenti tetap dipertahankan. Slot yang sudah
dibentuk dan belum dimainkan memakai paket baru saat jam bermain tiba. Ledger
pemotongan lama tidak ditulis ulang. Pembatalan mengembalikan kuota ke paket yang
menanggungnya, termasuk bagian minus yang sudah ditutup melalui paket baru.

Penghitungan menggunakan saldo bersama pelanggan lintas cabang. Akses publik ke
preview tetap memerlukan sesi pelanggan, dan produk harus tersedia di cabang
terpilih. Pemindahan internal hanya mengakses paket berbayar pelanggan yang sama.

Checkout pelanggan menampilkan perkiraan kuota paket, minus lama, dan sisa kuota.
Saldo dihitung ulang saat pembayaran berhasil karena sesi baru bisa mulai sebelum
pembayaran selesai. Paket Saya dan detail pemesanan admin menampilkan pelunasan
minus terpisah dari jam bermain. Riwayat pemakaian rutin mengikuti ledger tiap
paket, termasuk booking yang melewati pembelian paket pengganti.

## Penerapan

Sebelum menjalankan backend/worker baru:

```sh
bun run db:recurring-bookings
bun run db:membership-renewal
bun run db:generate
```

SQL hanya menambah kolom/tabel audit. Tidak mengubah saldo atau memindahkan aturan
lama dengan sendirinya. Database lokal sudah diperbarui. Di Docker dev, generate
client di setiap service yang memakai volume node_modules tersendiri, lalu restart.
Production harus menerapkan SQL dan membangun image/client baru sebelum digunakan.

## Verifikasi

```sh
bun run typecheck
bun run test
RUN_MEMBERSHIP_RENEWAL_DB_TESTS=1 RUN_RECURRING_DB_TESTS=1 node --import dotenv/config node_modules/vitest/vitest.mjs run src/services/membership-renewal.integration.test.ts src/services/recurring-booking.integration.test.ts
```

Tes database hanya untuk development. Fixture renewal-test-/recurring-test-
dibersihkan setelah tes. Tidak ada panggilan pembayaran gateway nyata dalam tes.
