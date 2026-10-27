# Data demo lokal

`seed-demo.ts` mengganti data aplikasi pada database development lokal `quantum_sport`. Cabang beserta seluruh kolom akun dan sesi SUPER_ADMIN dipertahankan persis. File upload dan layanan eksternal tidak dihapus.

Data yang dibuat:

- Dua cabang yang sudah ada, masing-masing 1 lapangan tenis dan 3 padel.
- 30 pelanggan bersama dan 30 booking lapangan, 15 tenis dan 15 padel.
- 9 karyawan baru per cabang: admin, viewer, 2 kasir, 3 pelatih (padel, tenis, multisolahraga), 2 ballboy.
- Jadwal 06.00–00.00 WIB setiap hari dari 7 hari lalu hingga 30 hari mendatang.
- 8 equipment, 6 paket membership bersama, 2 jenis pelatihan, 3 metode pembayaran.
- Booking contoh berstatus dikonfirmasi, hold, dan dibatalkan. Tidak ada pembayaran gateway, email, atau SMS yang dikirim.

## Pratinjau tanpa perubahan

Jalankan dalam container aplikasi development:

```sh
docker exec quantum-sport-app bun prisma/seed-demo.ts
```

## Mengganti data

Buat backup PostgreSQL terlebih dahulu, lalu jalankan seed dengan lokasi backup dan laporan di volume proyek. Penggantian seluruh data berlangsung dalam satu transaksi; pemeriksaan jumlah, jam buka, bentrok slot, dan nilai invoice dijalankan sebelum commit. Enum yang belum sinkron ditambahkan sebelum transaksi karena PostgreSQL mewajibkan commit label enum baru sebelum digunakan.

```sh
docker exec quantum-sport-app bun prisma/seed-demo.ts --apply --backup-file .backups/your-verified-backup.dump --report-file .backups/demo-data-report.json
```

Script menolak database selain nama/host lokal yang diizinkan dan lingkungan selain `NODE_ENV=development`. Default password hanya untuk akun dummy: `DummySport2026!`. Untuk menggantinya, berikan environment `DUMMY_PASSWORD` saat menjalankan script. Kredensial super admin tidak dibaca ke laporan atau diganti.

## Verifikasi API

Setelah seed, verifikasi login role, pembatasan cabang, daftar lapangan, jadwal, dashboard, inventory, dan membership:

```sh
docker exec quantum-sport-app bun prisma/verify-demo.ts
```

Laporan lengkap disimpan di `.backups/demo-data-report.json` (diabaikan Git).

## Tambahan transaksi Value Pack

`seed-value-pack-demo.ts` menambahkan 24 transaksi contoh (12 per cabang; Padel dan Tennis) tanpa menghapus atau mengganti data. Status mencakup aktif, menunggu pembayaran, ditangguhkan, kedaluwarsa, sesi habis, dan dibatalkan. Invoice dan pembayaran lokal dibuat tanpa menghubungi gateway atau mengirim pesan. ID tetap membuat script aman dijalankan ulang: transaksi yang sudah ada dilewati.

```sh
docker exec quantum-sport-app bun prisma/seed-value-pack-demo.ts
docker exec quantum-sport-app bun prisma/seed-value-pack-demo.ts --apply
```

## Role karyawan yang dihentikan

Role Coach dan Ballboy tidak dapat dipilih atau digunakan untuk login. Akun lama dan relasi booking tetap disimpan untuk riwayat, tetapi dikeluarkan dari daftar karyawan aktif. Seed demo membuat akun role lama dalam keadaan nonaktif untuk mendukung riwayat contoh.

Untuk database development lokal yang sudah ada:

```sh
docker exec quantum-sport-app bun prisma/retire-staff-roles.ts
docker exec quantum-sport-app bun prisma/retire-staff-roles.ts --apply
docker exec quantum-sport-app bun prisma/verify-retired-staff-roles.ts
```

## Banner bersama untuk seluruh cabang

Model Banner tidak memiliki cabang pemilik. Daftar dan perubahan banner dipakai bersama di semua cabang; pilihan cabang di dashboard tidak membatasi banner. Endpoint publik `/banners` dapat dibaca tanpa header cabang.

Perubahan database yang sudah memiliki kolom cabang ada di `prisma/global-banners.sql`. SQL hanya menghapus kolom pengaitan cabang, tanpa menghapus banner atau file gambar. Untuk development lokal:

```sh
docker exec quantum-sport-app bun prisma/make-banners-global.ts
docker exec quantum-sport-app bun prisma/make-banners-global.ts --apply
docker exec quantum-sport-app bunx prisma generate
```

Jalankan penyesuaian ini setelah setup cabang lama (`branches.sql`) bila masih digunakan.

## Tennis hanya di Cemara

Lapangan Tennis di luar Cemara dinonaktifkan untuk pemesanan baru. Record lapangan dan booking lama tetap disimpan. Pilihan Tennis pelanggan hanya menawarkan Cemara; admin tidak dapat membuat atau memesan Tennis di cabang lain. Seed demo menyimpan lapangan Tennis S. Parman sebagai data historis nonaktif.

```sh
docker exec quantum-sport-app bun prisma/cemara-only-tennis.ts
docker exec quantum-sport-app bun prisma/cemara-only-tennis.ts --apply
```
