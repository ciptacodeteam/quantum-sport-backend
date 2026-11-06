# Pembelian paket baru dan saldo minus

Pembelian membership baru yang berhasil dibayar menutup saldo minus dari paket
berbayar milik pelanggan yang sama dan olahraga yang sama. Kuota paket baru
dikurangi sebesar kuota yang tersedia. Paket lama menjadi nol bila kuota cukup;
jika belum cukup, kekurangannya tetap negatif pada paket lama dan paket baru
berhenti di nol. Saldo positif paket lama
tetap ada dan tidak digabungkan. Masa berlaku paket baru mengikuti pembeliannya.

Contoh: saldo lama -2, paket baru 10 → saldo lama 0 dan paket baru 8.
Saldo lama -12, paket baru 10 → saldo lama -2 dan paket baru 0.
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

## Rekonsiliasi saldo paket lama

Pelunasan berjalan pada pembayaran paket, setelah pemakaian booking rutin dicatat,
dan melalui scheduler tiap menit. Penanda `renewalAppliedAt` tetap mencegah
pengulangan aktivasi atau pergeseran masa berlaku, tetapi tidak lagi menghalangi
penutupan tunggakan yang terlewat. Paket lama yang sudah lunas dan sudah memiliki
paket pengganti dapat diperbaiki tanpa menunggu pembelian berikutnya.

Dana kuota hanya diambil dari paket **PAID**, belum kedaluwarsa/tidak ditangguhkan,
milik **userId** dan olahraga yang sama, serta dibeli/dibayar lebih baru. Nomor
invoice/nama pelanggan tidak dipakai untuk mencocokkan pemilik. Paket dengan
mulai berlaku mendatang yang sudah lunas bisa menutup tunggakan; tanggal mulai
bermainnya tetap dipertahankan. Urutan memakai paidAt invoice bila tersedia,
lalu createdAt dan ID untuk hasil konsisten.

Setiap pemindahan dicatat di `membership_debt_transfers`. Pengulangan membaca
saldo terkini di bawah kunci dompet pelanggan dan tidak memotong saldo yang sudah
tertutup. Potongan kumulatif pada paket baru ditambah, bukan ditimpa. Pembatalan
booking mengembalikan sesi ke paket yang benar-benar mendanai pelunasan.
Jika penghitung pelunasan lama tidak sesuai catatan transfer, dompet pada olahraga
tersebut ditandai untuk pemeriksaan dan tidak dipotong otomatis, termasuk oleh
paket berikutnya. Perubahan manual lama tanpa catatan lengkap tetap membutuhkan
audit; angka pada screenshot tidak dijadikan dasar pengurangan.

Contoh regresi: Robin -4 + 26 → 0 dan 22; JIM -2 + 24 → 0 dan 22. Tidak ada
penggabungan lintas pelanggan atau olahraga. Pelunasan tidak menciptakan minus
baru; pemakaian rutin berikutnya tetap dapat menimbulkan minus jika semua kuota
sudah habis.

Preview pembelian juga menghitung potensi penutupan menggunakan paket berbayar
yang sudah dimiliki, sehingga pembelian berikutnya tidak dikutip potongan dua
kali. Preview menampilkan sisa tunggakan bila paket baru tidak cukup. Laporan
tunggakan admin diperbarui otomatis setiap 30 detik.

Untuk memeriksa data existing, jalankan preview baca-saja:

```sh
bun run db:reconcile-membership-debt
```

Untuk menerapkan rencana pada database tujuan:

```sh
bun run db:reconcile-membership-debt --apply
```

Penerapan memakai transaksi per pelanggan dan aman diulang. Tidak ada kolom baru;
database harus sudah mempunyai tabel ledger dari `db:membership-renewal`. Scheduler
pada versi baru menjalankan rekonsiliasi yang sama secara otomatis. Pengujian
unit memakai data tiruan; pemeriksaan angka production memerlukan database aktif.
