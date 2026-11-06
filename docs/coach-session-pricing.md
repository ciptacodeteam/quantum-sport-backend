# Harga coach berdasarkan durasi sesi

Pada Jadwal & Harga setiap coach, isi **Harga jam pertama** dan **Harga per jam
berikutnya**. Contoh Rp200.000 dan Rp100.000 menghasilkan total Rp200.000,
Rp300.000, Rp400.000, Rp500.000, Rp600.000 untuk durasi 1–5 jam.
Harga berikutnya yang kosong mempertahankan harga normal; angka 0 berarti gratis.
Ballboy tetap memakai satu tarif per jam.

Harga lanjutan hanya berlaku pada coach yang sama dan slot satu jam berurutan
pada booking yang sama. Jeda atau pergantian coach memulai rangkaian baru; jam
berurutan melewati tengah malam tetap tersambung. Urutan pemilihan slot tidak
mempengaruhi harga. Melepas slot di keranjang menghitung ulang rangkaiannya.

Slot menyimpan harga normal dan harga lanjutan; BookingCoach menyimpan harga
aktual yang dibebankan. Perubahan jadwal memperbarui kedua harga hanya pada slot
terbuka yang belum dibooking. Harga dan invoice booking lama tetap tersimpan.
Checkout admin dan pelanggan serta validasi promo menghitung ulang harga di server.

Potongan lapangan coaching admin dihitung terpisah untuk setiap slot lapangan
berdasarkan cabang, olahraga, tanggal, dan band tarif yang berlaku. Harga lanjutan
coach tidak mengubah nominal potongan lapangan. Batas potongan sebesar harga
lapangan dan aturan membership tetap berlaku; checkout publik tidak mendapat
potongan khusus admin.

Penambahan layanan coach ke jam lapangan yang sudah dikonfirmasi memakai harga
lanjutan bila ada sesi coach yang sama persis satu jam sebelumnya, berstatus
CONFIRMED, pada booking lapangan yang sama atau layanan turunannya. Booking
terpisah, layanan dibatalkan, dan sesi HOLD tidak memenuhi syarat. Ini mengikuti
alur Tambah Layanan pada booking terkonfirmasi; tidak memperpanjang jam lapangan
secara otomatis. Tarif tambahan ditampilkan pada daftar layanan dan diperiksa
ulang ketika transaksi disimpan.

Sebelum menjalankan backend baru pada database yang sudah ada:

```sh
bun run db:coach-session-pricing
bun run db:generate
```

Kolom baru nullable: data lama tetap memakai harga per jam sebelumnya. SQL aman
diulang dan termasuk daftar migrasi fitur pada entrypoint Docker. Tes database
memerlukan database aktif; pengujian unit tidak menerapkan migrasi production.
