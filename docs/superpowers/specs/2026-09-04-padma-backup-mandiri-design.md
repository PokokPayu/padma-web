# PADMA — Backup Mandiri Database — Design Doc

**Tanggal:** 4 September 2026
**Status:** menunggu review

## 1. Konteks

PADMA berjalan di Supabase **free tier**, yang **tidak punya backup harian otomatis**, sementara
aplikasi ini menyimpan catatan medis pasien. Konsekuensi itu tidak berkaitan dengan trafik: sepi
atau ramai, kehilangan database berarti kehilangan catatan sesi, hasil skrining, dan akun pasien
tanpa jalan pulang. Dokumen ini merancang backup yang dibangun sendiri: `pg_dump` terjadwal,
terenkripsi, disimpan ke Cloudflare R2.

Bucket R2 sudah ada untuk rantai video, dan 10 GB pertamanya gratis — jadi biaya tambahannya nol.

## 2. Batas Kejujuran — apa yang dijamin dan apa yang tidak

Bagian ini ada supaya jaminannya tidak pernah dibaca lebih besar daripada kenyataannya.

**Yang dijamin:**

- Kehilangan maksimum **24 jam** data (RPO). Bukan nol, dan bukan "hampir nol".
- Setiap backup yang tersimpan **sudah terbukti bisa dipulihkan** — bukan sekadar terunggah.
- Backup lama tidak bisa dibaca siapa pun yang menguasai GitHub maupun R2, karena kunci
  dekripsinya tidak pernah ada di keduanya.

**Yang TIDAK dijamin:**

- **Objek Supabase Storage tidak ikut.** Gambar halaman e-book (`materi-halaman`) tinggal sebagai
  objek Storage, bukan baris database. Sesudah pemulihan, setiap e-book akan tampil rusak karena
  `material_pages` menunjuk objek yang tidak ada, dan admin harus **mengunggah ulang seluruh PDF**.
  Ini keputusan sadar (B3), bukan yang terlewat, dan runbook menyatakannya di paling atas.
- **Pemulihan bukan operasi satu klik.** Yang dibuktikan CI adalah dump-nya lengkap dan bisa
  dimuat ke Postgres polos. Menyusun ulang sebuah *project Supabase* dari dump itu — dengan
  peran, ekstensi, dan skema terkelola miliknya — adalah pekerjaan manual yang dipandu runbook.
  Siapa pun yang membaca "backup terverifikasi" sebagai "pulih otomatis" akan kecewa pada hari
  terburuk.
- **Bukan perlindungan terhadap penghapusan yang disengaja dan sabar.** Siapa pun yang menguasai
  token R2 CI bisa menghapus backup, dan retensi 30 hari berarti kerusakan yang baru disadari
  setelah sebulan sudah tidak punya salinan sehat.

## 3. Keputusan yang disepakati

| # | Keputusan | Alasan |
|---|---|---|
| B1 | Penjadwal: **GitHub Actions** cron pada repo privat | `pg_dump` tersedia di runner, cron gratis, riwayat jalannya terlihat, rahasia punya tempat resmi. Alternatif pg_cron+Edge Function ditolak karena Edge Function tidak punya `pg_dump`. |
| B2 | **Harian**, retensi **30 hari** | RPO 24 jam dinilai cukup untuk klinik ini; 30 salinan database sekecil ini jauh di bawah 10 GB gratis. |
| B3 | **Database saja**; objek Storage menyusul sebagai pekerjaan terpisah | Pilihan sadar pemilik. Lubangnya didokumentasikan keras, bukan dibiarkan senyap. |
| B4 | **Verifikasi dengan memulihkan sungguhan di setiap jalan** | Backup yang belum pernah dipulihkan bukan backup, melainkan harapan. Biayanya ~1–2 menit runner, gratis. |
| B5 | Enkripsi **`age` dengan kunci publik**; kunci privat hidup **di luar** GitHub dan R2 | Bila GitHub Secrets bocor, seluruh riwayat backup tetap tertutup. Passphrase simetris ditolak justru karena CI-nya bisa membuka semuanya. |
| B6 | Urutan: dump → **verifikasi** → enkripsi → unggah | Verifikasi terjadi selagi data masih polos, sehingga CI **tidak pernah** perlu kemampuan mendekripsi. |
| B7 | Bucket **terpisah** `padma-backup` dengan **token terpisah** | Token CI yang bisa menghapus backup tidak boleh sekaligus bisa menghapus pustaka video. |
| B8 | Retensi dijalankan **job**, bukan lifecycle rule R2 | Token non-admin tidak bisa memasang lifecycle. Efek sampingnya sehat: keputusan "objek mana yang kedaluwarsa" jadi fungsi murni yang diuji Vitest, bukan aturan tak terlihat di dashboard. |
| B9 | Koneksi lewat **Supavisor session pooler**, bukan direct connection | Host direct Supabase hanya punya record AAAA (IPv6-only) dan runner GitHub praktis IPv4 — terbukti empiris, lihat §4. Transaction pooler (6543) tidak dipakai karena `pg_dump` bermasalah di mode transaksi. |

## 4. Temuan empiris yang mengikat desain

Diuji 4 September 2026 terhadap project sungguhan:

- `db.<ref>.supabase.co` **hanya punya record AAAA** (`2406:da12:…`), dan tidak ada rute IPv6 ke
  sana bahkan dari mesin dev. Connection string "Direct connection" karena itu **tidak bisa
  dipakai dari GitHub Actions**.
- IPv6 itu cocok dengan rentang AWS **ap-northeast-2 (Seoul)** — region project.
- Endpoint pooler yang menemukan tenant: `aws-0-ap-northeast-2.pooler.supabase.com`, user
  `postgres.<ref>`. (Galatnya berubah dari `tenant/user not found` menjadi
  `password authentication failed`, yang membuktikan tenant benar.)
- Bucket `padma-backup`: privat, location hint **APAC**, dan token dapat list/tulis/baca/hapus.

## 5. Arsitektur

Satu workflow, satu job, berjalan **20:00 UTC = 03:00 WIB** — jam paling sepi, dan cron GitHub
memang berjalan UTC.

```
1. checkout + pasang klien PostgreSQL (versi mayor >= server) + age
2. periksa versi server; klien lebih tua  -> GAGAL keras
3. pg_dump -Fc  lewat session pooler      -> padma-YYYYMMDD-HHMMSSZ.dump
4. jalankan Postgres service container    -> pg_restore dump itu
5. query kewarasan di hasil restore       -> gagal = job merah, TIDAK mengunggah
6. age -r $AGE_PUBLIC_KEY                 -> .dump.age
7. unggah ke R2 padma-backup
8. retensi: hapus objek berumur > 30 hari
```

**Langkah 2 bukan basa-basi.** `pg_dump` menolak server yang lebih baru daripada dirinya, dan
runner Ubuntu membawa versi klien yang berubah tanpa pemberitahuan. Tanpa pemeriksaan eksplisit,
kegagalannya muncul sebagai pesan versi yang mudah dikira galat jaringan.

**Langkah 5 adalah inti janji B4.** Query kewarasannya memeriksa: tabel inti ada, `auth.users`
ikut ter-dump, dan jumlah baris tabel-tabel yang seharusnya berisi tidak nol. Ambang "tidak nol"
sengaja longgar — tujuannya menangkap dump kosong/terpotong, bukan mengaudit isi.

### Berkas

| Berkas | Tanggung jawab |
|---|---|
| `.github/workflows/backup-db.yml` | Orkestrasi seluruh langkah di atas |
| `web/src/lib/backup/retensi.ts` | **Fungsi murni**: daftar objek + waktu sekarang + hari simpan → objek mana yang dihapus |
| `web/src/lib/backup/nama-objek.ts` | **Fungsi murni**: cap waktu → kunci objek, dan kebalikannya |
| `web/scripts/backup/unggah-r2.ts` | Unggah + terapkan retensi (memakai kedua fungsi murni di atas) |
| `web/tests/backup-retensi.test.ts` | Tes fungsi murni, termasuk batas dan zona waktu |
| `docs/runbook-pemulihan.md` | Prosedur pemulihan, dibuka dengan peringatan Storage |

Logika yang bisa salah diam-diam (memilih objek untuk **dihapus**) sengaja ditarik keluar dari
skrip shell menjadi fungsi murni TypeScript, supaya ia diuji seperti seluruh repo ini. Yang
tersisa di shell hanya orkestrasi yang gagalnya berisik.

## 6. Penamaan objek & retensi

```
db/2026/09/padma-20260904-200000Z.dump.age
```

Cap waktu **UTC**, `Z` eksplisit, dan seluruhnya **string** — tanpa `toISOString()` pada objek
`Date` yang bergantung zona waktu mesin, sesuai aturan repo.

Retensi menghapus objek yang **umurnya lebih dari 30 hari dihitung dari cap waktu pada namanya**,
bukan dari `LastModified` R2. Alasannya: `LastModified` berubah bila objek pernah ditulis ulang,
sementara nama tidak — dan yang kita maksud memang "umur data", bukan "umur berkas".

Retensi berjalan **sesudah** unggahan sukses. Bila unggahan gagal, tidak ada yang dihapus:
lebih baik menyimpan kelebihan satu hari daripada menghapus salinan lama demi salinan baru yang
ternyata tidak pernah ada.

## 7. Keamanan

- **Kunci privat `age` tidak pernah masuk GitHub maupun R2.** Ia hidup di password manager
  pemilik. CI hanya memegang kunci publik, yang bukan rahasia.
- **Token R2 CI dilingkup hanya ke `padma-backup`**, Object Read & Write. Ia tidak boleh bisa
  menyentuh `padma` (video).
- Rahasia disimpan sebagai **GitHub Secrets**, tidak pernah dicetak ke log. Skrip dilarang
  meng-`echo` connection string.
- **Latihan dekripsi wajib.** Sekali sesudah pemasangan, lalu **tiap kuartal**: unduh satu backup
  dan buka dengan kunci privat di mesin sendiri. Tanpa latihan ini, salah kunci baru ketahuan
  pada hari terburuk — dan itulah satu-satunya cara kegagalan yang tidak bisa dideteksi CI,
  justru karena CI sengaja tidak bisa mendekripsi.

## 8. Error handling

| Keadaan | Yang terjadi |
|---|---|
| Koneksi DB gagal / sandi salah | Job merah di langkah dump. Tidak ada yang diunggah, backup kemarin utuh |
| Versi klien < server | Job merah di langkah 2, dengan pesan yang menyebut kedua versi |
| Dump kosong / terpotong | Ketahuan di langkah 5 (restore + query kewarasan). Job merah, tidak mengunggah |
| Enkripsi gagal | Job merah. Tidak ada berkas polos yang pernah diunggah |
| Unggah R2 gagal | Job merah, retensi **tidak** dijalankan |
| Retensi gagal | Job merah, tetapi backup hari itu sudah aman tersimpan |
| Secret belum dipasang | Job merah dengan pesan yang menyebut nama secret-nya |

Pemberitahuan memakai **email bawaan GitHub** untuk workflow terjadwal yang gagal. Tidak ada
integrasi tambahan: satu kanal yang pasti terbaca lebih baik daripada dua yang diabaikan.

## 9. Testing

- **Vitest** untuk fungsi murni: pemilihan objek kedaluwarsa (termasuk batas persis 30 hari,
  objek berumur negatif akibat jam mesin, dan daftar kosong), serta penamaan objek bolak-balik.
- **Job itu sendiri** dibuktikan dalam dua tahap, dan **tidak** dengan menunjuk workflow ke
  database lokal — runner GitHub tidak punya jalan menuju Postgres Docker di mesin dev, jadi
  "jalankan workflow terhadap database lokal" adalah instruksi yang mustahil dijalankan:
  1. **Di mesin dev:** skrip yang sama dijalankan tangan terhadap Postgres Docker lokal. Ini
     membuktikan rantai dump → restore → verifikasi → enkripsi tanpa menyentuh apa pun di luar.
  2. **Di CI:** satu jalan `workflow_dispatch` yang men-dump dari **Postgres service container**
     berisi migrasi repo, bukan dari produksi. Ini membuktikan langkah-langkah runner — pemasangan
     klien, pemeriksaan versi, `age`, unggah R2, retensi — tanpa risiko pada data sungguhan.
- Baru sesudah keduanya hijau, workflow diarahkan ke produksi.
- Tidak ada tes otomatis yang menyentuh produksi.

## 10. Env & konfigurasi

Seluruhnya GitHub Secrets; tidak satu pun masuk repo.

| Nama | Guna |
|---|---|
| `SUPABASE_DB_URL` | Connection string **session pooler** berikut sandinya |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Token yang dilingkup **hanya** ke `padma-backup` |
| `R2_BUCKET_BACKUP` | `padma-backup` |
| `AGE_PUBLIC_KEY` | Penerima enkripsi (bukan rahasia, disimpan seragam) |

## 11. Urutan pemasangan (go-live)

1. Reset sandi database Supabase; simpan connection string session pooler ke `SUPABASE_DB_URL`.
2. Terbitkan token R2 berlingkup `padma-backup`; simpan ketiga nilainya.
3. Buat pasangan kunci `age`; **kunci privat ke password manager**, publiknya ke `AGE_PUBLIC_KEY`.
4. Jalankan skrip di mesin dev terhadap Postgres lokal, lalu `workflow_dispatch` sekali dengan
   sumber Postgres service container (lihat §9) — **bukan** dengan menunjuk workflow ke mesin dev,
   yang tidak terjangkau runner. Sesudah keduanya hijau, arahkan ke produksi.
5. Lakukan latihan dekripsi pertama.
6. **Baru** aktifkan blok `schedule:`.

Langkah 6 sengaja terakhir. Jadwal yang aktif sebelum rahasianya lengkap akan gagal setiap hari,
dan alarm yang berbunyi tiap hari adalah alarm yang berhenti dibaca.

## 12. Di luar scope

- Objek Supabase Storage (B3) — pekerjaan terpisah berikutnya.
- Backup point-in-time / WAL streaming. Menuntut tier berbayar; RPO 24 jam sudah disepakati.
- Replikasi ke penyedia kedua.
- Pemulihan otomatis. Runbook manual dinilai cukup, dan lebih jujur.
