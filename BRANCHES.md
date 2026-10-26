# Cabang

Akun pelanggan dan saldo MembershipUser terpusat. Data operasional memiliki branchId. Seluruh data lama dipetakan ke `cemara`; dua cabang awal adalah `cemara` dan `s-parman`. Membership lama menerima kedua cabang melalui MembershipBranch. Menambah cabang tidak otomatis memperluas paket lama.

## Menjalankan perubahan

1. Cadangkan database dengan prosedur operasional yang biasa dipakai.
2. Jalankan `bun run db:generate`.
3. Jalankan `bun run db:setup-branches --super-admin-email=superadmin@quantumsocialclub.com --from-admin-email=admin@quantum.com` dengan DATABASE_URL database tujuan. Skrip menerapkan `prisma/branches.sql` secara transaksional tanpa menghapus booking, invoice, atau saldo. Akun sumber wajib merupakan ADMIN aktif; pergantian email mempertahankan password akun sumber. Tanpa opsi email, hanya struktur cabang yang dipasang.
4. Restart backend, deploy frontend, dan login kembali ke dashboard.
5. Super admin memilih cabang sebelum membuat lapangan, jadwal, inventori, atau staf. Gunakan **Kelola cabang** untuk menugaskan staf dan mengatur cakupan membership. Cabang S. Parman mulai tanpa data lapangan: buat fasilitas yang benar di cabang tersebut.

Jangan memakai `db:fresh` atau seed contoh untuk migrasi data produksi. `db:push` saja tidak membuat dua cabang awal atau cakupan membership; gunakan skrip setup.

## Batas akses

Pelanggan mengirim `X-Branch-ID`. Backend memvalidasi cabang aktif, menyaring katalog, memeriksa resource dan relasi checkout, dan menyimpan cabang pada booking/invoice. Riwayat pelanggan tetap dapat menampilkan transaksi miliknya di semua cabang.

Identitas, peran, dan cabang staf dibaca ulang dari database pada setiap request admin. Header cabang tidak bisa memperluas hak staf. SUPER_ADMIN dapat membaca gabungan semua cabang tanpa header; perubahan operasional memerlukan satu cabang. Katalog membership, tipe coaching, dan metode pembayaran bersama hanya dapat diubah SUPER_ADMIN.

Isolasi query dan relasi diterapkan oleh ekstensi Prisma `branch-scope.ts`, memakai AsyncLocalStorage untuk menjaga konteks setiap request dan transaksi. Scheduler serta webhook berjalan tanpa cabang terpilih agar dapat merekonsiliasi transaksi lintas lokasi. Query SQL costing memvalidasi resource menggunakan query yang sudah dibatasi cabang sebelum mengakses SQL.

## Pengujian integrasi

Gunakan database PostgreSQL sementara khusus pengujian, pasang skema terbaru, lalu jalankan:

`TEST_BRANCH_DATABASE_URL=postgresql://... npx vitest run src/lib/branch-scope.integration.test.ts`

Tes ini menambah dan membersihkan fixture sendiri. Jangan arahkan TEST_BRANCH_DATABASE_URL ke database produksi.
