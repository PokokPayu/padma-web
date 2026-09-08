# C1-c — Catatan Tindak Lanjut (penutup C1)

**Spec:** keputusan **J10** (rating layanan & bidan) dan **J12** (QRIS asli).
**Cabang:** `c1c-rating`, dari `main` `23f0764`.

Dengan ini **seluruh C1 tuntas**: J1/J2/J7/J8/J13 di C1-a, J3–J6/J9/J11 di C1-b, J10/J12 di sini.

## Bukti

| Perintah | Hasil |
|---|---|
| `npm test` | **156 berkas, 2.400 uji, 0 gagal** |
| `npm run build` | lolos |
| 8 skrip E2E | seluruhnya lolos (22/21/22/14/26/26/10/12) |
| Sisa data sesudah E2E | **nol** — diperiksa langsung ke basis data |
| `test:e2e:video` | TIDAK dijalankan — bucket R2 produksi klien |

## Keputusan

1. **Dua bintang, tidak pernah dirata-ratakan.** Pertanyaan yang dijawab layar owner adalah
   "orangnya atau layanannya?" — satu angka gabungan menghapus pertanyaannya.
2. **Penilaian menyimpan SALINAN siapa bidannya dan varian apa saat itu.** Mitra pada sebuah sesi
   bisa berganti (bidan sakit, jadwal ulang di C3); penilaian yang menempel lewat rujukan akan
   diam-diam berpindah orang. Trigger MENULIS ULANG ketiga kolom dari baris sesi, jadi salinannya
   tidak bisa dikarang peramban.
3. **Tidak ada view agregat.** View agregat persis yang dulu membocorkan rate card lengkap ke admin
   di repo ini; angka tren dihitung dari baris yang sudah lolos RLS.
4. **Yang TIDAK dilakukannya diberi pagar yang bisa merah**: rating tidak menyentuh honor, tidak
   dipakai memilih mitra, tidak pernah terlihat klien lain, komentarnya tidak pernah jadi markup.
5. **QRIS**: gambar, merchant, dan NMID pindah ke `app_settings`; komponen QR dekoratif dihapus.
   QRIS statis tidak menyebut nominal, jadi satu-satunya yang bisa diperiksa mata sebelum mengirim
   uang adalah nama penerimanya — karena itu merchant & NMID wajib tampil.

## Dua cacat yang ditemukan E2E, dan hanya E2E

**1. Pesan sukses tertimpa kalimat yang berbohong.** Begitu pengajuan tersimpan, skrining yang
menopangnya hangus — sehingga `/passport/ajukan` sah berubah menjadi "Isi skrining keselamatan
dulu", menimpa panel sukses. Klien yang baru saja memesan dibacakan kalimat yang menyuruhnya
mengulang skrining. Tidak satu pun uji unit bisa melihat ini: keduanya benar sendiri-sendiri, yang
salah adalah urutannya. Sesudah berhasil, klien kini dipindahkan ke beranda dengan konfirmasi.

**2. Skrip E2E meninggalkan sisa.** Blok penutupnya memanggil `keadaanAwal()` supaya skrip bisa
diulang; sejak C1-c fungsi itu juga MENERBITKAN skrining, jadi tiap selesai ia meninggalkan satu
baris yang memerahkan uji penghitung inbox admin **di berkas yang sama sekali lain**. Menyiapkan dan
membersihkan kini dipisah.

Keduanya kelas yang sama: **kegagalan yang tidak muncul di jalur yang sedang diuji.**

## Batas yang jujur

**"Ganti QRIS tanpa deploy" berlaku untuk MENGGANTI RUJUKANNYA lewat panel**, bukan mengunggah
berkas baru. Selama belum ada unggahan aset di panel, nilai bawaannya menunjuk berkas di `public/`,
dan mengganti gambarnya sungguhan masih menuntut menaruh berkas itu di suatu tempat.

## Utang

- **Bidan tidak melihat penilaian dirinya** — belum ada akun mitra (di luar lingkup C1).
- **Tidak ada notifikasi apa pun saat penilaian rendah masuk.** Admin menemukannya dengan membuka
  layar. Cukup untuk sekarang; notifikasi milik C2.
- **Tren owner membaca maksimal 1.000 baris** (`.limit(1000)`), sejalan dengan batas PostgREST.
  Di volume klinik ini masih jauh; begitu mendekat, ia perlu agregasi sisi basis data — dan itu
  menuntut memikirkan ulang larangan view agregat.
