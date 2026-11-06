# Aktivasi akun walk-in melalui WhatsApp

Login mengecek nomor yang sudah dinormalisasi terlebih dahulu. `/auth/check-account`
mengembalikan `nextAction` berupa REGISTER, ACTIVATE, atau LOGIN. `exists` tetap
tersedia untuk kompatibilitas: true berarti akun mengikuti login.

Nomor baru menuju pendaftaran. Walk-in dengan nomor belum terverifikasi menuju
form Aktivasi akun walk-in yang menggunakan nomor yang sama. Akun lama dengan
password yang pernah dibuat pelanggan, akun terverifikasi, dan akun Google tetap
mengikuti login/lupa password, bukan ditimpa melalui pendaftaran. Walk-in lama
yang dahulu memakai password otomatis berupa nomor HP dikenali lewat source
WALK_IN dan phoneVerified=false. Walk-in baru dibuat tanpa password.

Form pendaftaran/aktivasi mengumpulkan nama depan, nama belakang opsional, dan nomor
WhatsApp. Setelah OTP benar, halaman berikutnya meminta password baru. Nama lengkap tetap disimpan pada `name` untuk kompatibilitas
booking dan invoice. First/last name disimpan terpisah setelah OTP sah. Nama formulir hanya ditahan sementara di memori browser sampai verifikasi;
mengirim OTP tidak membuat akun atau mengubah data pelanggan.

Permintaan OTP memakai `purpose: REGISTER`; pengiriman ulang harus memakai tujuan
yang sama. OTP berlaku 10 menit, pengiriman ulang diberi jeda satu menit, dan tiap
permintaan dibatasi lima percobaan. OTP reset password dan verifikasi umum tidak
bisa dipakai sebagai OTP pendaftaran.

Endpoint `/auth/verify-registration-otp` menukar OTP sah dengan registrationToken
acak yang hanya dikirim ke browser; database menyimpan hash-nya, terikat nomor,
requestId, tujuan REGISTER, dan masa berlaku OTP. Pembuatan password memerlukan
token tersebut. Pengiriman ulang OTP membatalkan token sebelumnya.

Setelah password diisi, backend mengunci data pelanggan dan mengonsumsi token
secara kondisional dalam transaksi yang sama dengan perubahan profil dan sesi.
API tetap menerima kode OTP langsung dari client versi lama, dengan validasi
kepemilikan dan konsumsi sekali pakai yang sama.
Aktivasi memperbarui akun lama berdasarkan ID, tanpa membuat duplikat, menghapus
riwayat booking, memindahkan membership, atau mengubah source asal pelanggan.
Sesi refresh lama dicabut sebelum sesi baru dibuat. OTP yang dipakai ulang,
kedaluwarsa, diganti oleh resend, atau gagal diverifikasi tidak mengubah profil.
Akun yang menjadi aktif saat proses berjalan juga tidak dapat ditimpa.

Akun online lama dengan password tetapi nomor belum terverifikasi tetap diarahkan
ke login/lupa password. Penyelesaian reset melalui OTP WhatsApp menandai nomor
terverifikasi. Status belum terverifikasi saja tidak mengizinkan penggantian profil
melalui pendaftaran.

## Deployment

Jalankan sebelum backend baru mengakses database yang sudah ada:

```sh
bun run db:customer-activation
bun run db:generate
```

SQL menambah firstName/lastName nullable dan penghitung percobaan OTP. Data nama
lama tidak dipecah secara otomatis, nomor lama tidak diubah, dan status verifikasi
akun lama tidak direset. Docker entrypoint menyertakan SQL ini secara otomatis.
Pengiriman OTP nyata tetap memerlukan konfigurasi provider WhatsApp yang aktif;
tes unit memakai provider tiruan dan tidak menerapkan perubahan ke production.
