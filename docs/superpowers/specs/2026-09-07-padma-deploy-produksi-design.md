# Deploy Produksi Pertama — PADMA

Tanggal: 7 September 2026
Status: rancangan disetujui, menunggu rencana implementasi

## 1. Masalah

PADMA belum pernah sekali pun di-deploy. Tidak ada lingkungan produksi, tidak
ada domain, tidak ada `.vercel/` maupun `vercel.json` di repo. Seluruh
verifikasi yang ada — 45 migrasi, suite vitest, delapan skenario E2E — hanya
pernah dijalankan di Supabase lokal.

Beberapa catatan lama menyebut "sisa go-live" seolah produksi sudah berdiri.
Itu keliru dan menyesatkan soal kemajuan: butir seperti "tambahkan domain
produksi ke `AllowedOrigins` R2" mustahil dikerjakan sebelum ada alamatnya.

Rancangan ini menetapkan cara menaikkan PADMA ke produksi untuk pertama kali.

## 2. Keputusan yang sudah diambil

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Sifat rilis | Produksi langsung, bukan staging | Keputusan pemilik, 7 Sep 2026 |
| Hosting | Vercel Hobby, root directory `web/` | Keputusan 31 Ags 2026 |
| Alur deploy | **Pendekatan A** — Git integration, migrasi manual | Pasangan kode↔skema masih perlu mata manusia |
| Database | Proyek Supabase **baru**, region `ap-southeast-1` (Singapore) | Lihat §3 |
| Alamat | `*.vercel.app` dulu, domain sendiri menyusul | Keputusan pemilik |
| Gerbang rilis | Rotasi kunci Supabase + R2; Google OAuth jalan | Keputusan pemilik |

### Alur deploy yang ditolak

- **CLI manual (`vercel --prod` dari laptop)** — deploy bergantung pada satu
  mesin, tidak ada jejak commit→deploy. Tidak pantas untuk aplikasi yang
  menyimpan rekam medis.
- **`supabase db push` otomatis di GitHub Actions** — menuntut connection
  string produksi tinggal di secret GitHub, dan migrasi merusak (§4) akan
  jalan tanpa ada yang melihat. Terlalu dini; dipertimbangkan lagi setelah
  beberapa rilis.

## 3. Pindah region: Seoul → Singapore

Proyek Supabase lama (`fcwmkwbgvkbxbxiritke`, "Padma Wellness App") berdiri di
`ap-northeast-2` (Seoul) dan sudah pernah menerima `db push` sampai migrasi
`20260903000000_kunci_paksa_aktor_penugasan`.

Supabase tidak menyediakan kontrol ganti region; satu-satunya jalur yang
terdokumentasi adalah membuat proyek baru dan memulihkan isinya ke sana.
Jakarta (`ap-southeast-3`) tidak ditawarkan sama sekali — Singapore
(`ap-southeast-1`) adalah yang terdekat dari Indonesia.

Biaya pindah **nol pada saat ini dan hanya naik setelahnya**:

1. Belum ada klien, jadi tidak ada yang perlu dipindahkan.
2. Dua dari 16 migrasi tertunggak justru menghapus isi (§4) — apa pun yang
   ada di Seoul memang akan hilang di langkah berikutnya.
3. Proyek baru lahir dengan kunci baru, sehingga gerbang "rotasi kunci
   Supabase" terpenuhi sekaligus, dan kunci lama yang pernah melewati kanal
   chat mati bersama proyeknya.
4. Latensi: Singapore ±30–50 ms dari Malang, Seoul ±90–120 ms. Halaman panel
   staf menembak beberapa query berurutan, jadi selisihnya dikali.

Konsekuensi: region fungsi Vercel disetel ke **`sin1`**, bukan `icn1`.
Proyek Seoul dihapus setelah proyek baru terbukti jalan.

### Setelan pembuatan proyek

Prinsip yang mengikat semua setelan ini: **hosted harus sedekat mungkin dengan
`supabase start` lokal**, karena di situlah 45 migrasi dan seluruh test
terbukti. Tiap penyimpangan adalah bug yang hanya muncul di produksi.

| Setelan | Nilai | Alasan |
|---|---|---|
| Region | Southeast Asia (Singapore) | §3 |
| GitHub integration | **kosong** | Mengaktifkannya = pendekatan C yang ditolak; migrasi merusak akan jalan sendiri |
| Enable Data API | **nyala** | Aplikasi memakai PostgREST lewat supabase-js |
| Automatically expose new tables | **nyala** | Lihat di bawah — kritis |
| Enable automatic RLS | **mati** | Migrasi `rls_policies` & `harden_rls` menyalakan RLS eksplisit per tabel; event trigger tambahan membuat hosted berbeda dari lokal |

**Kenapa "Automatically expose new tables" wajib nyala,** meski dashboard
menyarankan sebaliknya: saran itu benar untuk skema yang menulis `grant`
sendiri. Skema PADMA tidak. `sessions`, `clients`, dan `materials` tidak punya
satu pun `grant` eksplisit di seluruh 45 migrasi — hak bawaan itulah
satu-satunya sumbernya, lalu dipersempit lewat `revoke ... from anon`
(posturnya "beri bawaan, lalu cabut yang berlebih"; lihat
`20260828185500_cabut_grant_anon_berlebih.sql`). Dimatikan berarti klien tidak
bisa membaca sesi, materi, atau profilnya sendiri — dan gagalnya **hanya di
produksi**, karena Supabase lokal memakai perilaku bawaan yang menyala.

Sandi database disalin ke password manager saat pembuatan. Ia tidak
ditampilkan lagi, dan dibutuhkan untuk `db push` sekarang serta untuk secret
`SUPABASE_DB_URL` saat backup dihidupkan.

## 4. Migrasi yang merusak data

Dari 16 migrasi yang belum pernah jalan di hosted, dua menghancurkan isi:

- `20260904120000_materi_video_r2.sql:9` — `delete from public.material_videos;`
- `20260906140000_bubarkan_service_rates.sql:21` — `drop table public.service_rates;`

Di proyek Singapore yang baru keduanya tidak berbahaya: database lahir kosong
dan seluruh 45 migrasi jalan berurutan dari nol. Keduanya dicatat di sini
karena akan berbahaya pada jalur alternatif mana pun yang memakai database
berisi, termasuk jika kelak proyek Seoul dihidupkan lagi.

## 5. Penghalang rilis: tabel `phases` lahir kosong

`supabase db push` **tidak** menjalankan `seed.sql`; ia hanya menerapkan
migrasi. Sementara itu `seed.sql` mencampur dua jenis data yang berbeda sifat:

| Data | Sifat | Sesudah `db push` |
|---|---|---|
| `phases` (5 fase) | **acuan wajib** — id teksnya dirujuk kode | kosong → **rusak** |
| `transport_rates` | konfigurasi | kosong → diisi lewat `/owner/transport` |
| `app_settings.nomor_wa` | konfigurasi | kosong → diisi lewat panel |
| `services`, `materials`, `packages`, `partners` | katalog dummy | kosong → benar, client mengisi sendiri |

`phases` adalah penghalang sungguhan. Di seluruh kode tabel itu **hanya
dibaca** — tidak ada satu pun `insert` atau `upsert`, jadi tidak ada jalan
mengisinya lewat panel. Produksi akan lahir dengan katalog yang tidak
menampilkan apa pun.

Tidak ada test yang menangkap ini, karena test selalu berjalan di atas
`db reset` yang menjalankan `seed.sql`.

**Perbaikan:** migrasi baru yang menanam 5 baris `phases` dengan
`on conflict (id) do nothing`. Fase adalah data acuan, bukan katalog dummy —
id teksnya (`prekonsepsi`, `kehamilan`, `nifas`, `menopause`, `newborn`)
dirujuk kode, jadi tempatnya di migrasi. Idempoten, sehingga aman bagi DB
lokal yang sudah punya. Baris `phases` di `seed.sql` menjadi mubazir dan
dihapus dari sana agar tidak ada dua sumber kebenaran.

## 5b. Perubahan kode yang harus mendahului deploy

Deploy ini bukan pekerjaan konfigurasi murni. Tiga perubahan repo harus
ter-merge ke `main` **sebelum** `db push` di §8:

1. Migrasi baru penanam `phases` (§5), dan pencabutan baris `phases` dari
   `seed.sql`.
2. `NOMINATIM_USER_AGENT` dan `NOMINATIM_JEDA_MINIMAL_MS` masuk `.env.example`
   (§6).
3. Bagian "Deploy" di `web/README.md:272` — kini tiga baris — diganti runbook
   yang mengikuti rancangan ini.

## 6. Env di Vercel

Sembilan variabel, **hanya pada scope Production**:

| Variabel | Isi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL proyek Singapore |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | kunci klien proyek baru |
| `SUPABASE_SERVICE_ROLE_KEY` | kunci server proyek baru |
| `R2_ACCOUNT_ID` | token R2 hasil rotasi |
| `R2_ACCESS_KEY_ID` | token R2 hasil rotasi |
| `R2_SECRET_ACCESS_KEY` | token R2 hasil rotasi |
| `R2_BUCKET_VIDEO` | `padma` |
| `PADMA_PROXY_TEPERCAYA` | `1` |
| `NOMINATIM_USER_AGENT` | `PADMA-Wellness/1.0 (<email kontak asli>)` |

**Sengaja tidak dipasang:**

- `SUPABASE_DB_URL` — khusus test struktural (`tests/helpers/db.ts`). Kalau
  terpasang, test bisa menembak database produksi.
- `NOMINATIM_JEDA_MINIMAL_MS` — harus tetap kosong agar jeda 1 detik berlaku.

**Env tidak dipasang di scope Preview.** Dengan Git integration setiap PR
melahirkan URL preview; kalau env produksi ikut terpasang, kode yang belum
di-review menulis ke database pasien. Konsekuensi yang diterima: preview tidak
berfungsi.

Dua jebakan:

1. `NEXT_PUBLIC_*` dibekukan **saat build**. Env wajib lengkap sebelum deploy
   pertama; menambahkannya belakangan menuntut redeploy, bukan restart.
2. Throttle Nominatim disimpan di variabel scope-modul
   (`src/lib/transport/geocode.ts:33`). Di serverless tiap instance punya
   scope sendiri, jadi throttle itu tidak berlaku lintas instance. Tabel
   `geocode_cache` meredam tapi tidak menghapus. `NOMINATIM_USER_AGENT` yang
   asli karena itu bukan formalitas: bila OSM memblokir, gejalanya "alamat
   tidak ditemukan", bukan error.

`NOMINATIM_USER_AGENT` dan `NOMINATIM_JEDA_MINIMAL_MS` belum terdaftar di
`.env.example` dan ditambahkan sebagai bagian pekerjaan ini.

## 7. Auth, Google, dan CORS

Aplikasi **tidak punya `signUp` maupun reset password**. `form-masuk.tsx`
hanya memanggil `signInWithPassword` dan `signInWithOAuth`. Klien masuk lewat
tautan undangan yang dibuat admin (`createClientInvite`), lalu login.

Dua akibatnya:

- Tidak ada email yang dikirim Supabase di jalur kritis, jadi SMTP bawaan free
  tier — yang dibatasi ketat dan bukan untuk produksi — tidak menghalangi
  rilis.
- Karena tidak ada `signUp`, **Google OAuth adalah satu-satunya cara klien
  nyata memperoleh akun.** Tanpa itu tidak ada klien yang bisa masuk sama
  sekali. Akun admin dan owner dibuat tangan lewat dashboard Supabase.

Setelan, semuanya baru bisa dikerjakan **setelah URL Vercel lahir**:

- **Supabase → Auth → URL Configuration:** Site URL `https://<app>.vercel.app`,
  Redirect URLs `https://<app>.vercel.app/**`. Wildcard preview sengaja tidak
  ditambahkan, konsisten dengan §6. `inviteLink()` memakai `origin` permintaan,
  jadi tautan undangan otomatis benar begitu Site URL betul.
- **Google Cloud Console:** authorized JavaScript origin
  `https://<app>.vercel.app`; authorized redirect URI
  `https://<ref-baru>.supabase.co/auth/v1/callback`. Redirect-nya ke Supabase,
  **bukan** ke Vercel — ini kesalahan paling umum. Client ID dan secret
  ditempel ke Supabase → Auth → Providers → Google.
- **Cloudflare R2:** tambahkan `https://<app>.vercel.app` ke `AllowedOrigins`
  bucket `padma`. Verifikasinya lewat preflight, tidak menuntut kredensial.

## 8. Urutan operasi

**Fase 0 — database, sebelum menyentuh Vercel**

1. Buat proyek Supabase Singapore dengan setelan §3; simpan sandi DB. ✅ selesai
2. Merge ketiga perubahan kode §5b ke `main`.
3. Hapus proyek Seoul lama (`fcwmkwbgvkbxbxiritke`) setelah kunci proyek baru
   tersalin ke password manager, supaya dua proyek senama tidak tertukar.
4. `npx supabase link --project-ref <ref-baru>`.
5. `npx supabase db push` — 45 migrasi + migrasi `phases` §5.
6. Rotasi kredensial R2 (token baru, tetap berlingkup Object Read & Write
   bucket `padma`).
7. Perbarui `web/.env.hosted` lokal dengan kunci-kunci baru.

**Fase 1 — Vercel**

8. Import repo `PokokPayu/padma-web`, **root directory `web/`**, framework
   Next.js. Root repo tidak berisi `package.json`.
9. Pasang sembilan env §6 pada scope Production.
10. Setel region fungsi ke `sin1`.
11. Deploy.

**Fase 2 — sesudah URL produksi lahir**

12. R2 `AllowedOrigins`, Supabase Auth URL Configuration, Google OAuth (§7).
13. Isi data lewat panel: `nomor_wa`, empat baris tarif transport di
    `/owner/transport`, katalog layanan sungguhan. **Jangan** jalankan
    `npm run seed:users` — sandi seragam `padma-dev-123` dan email
    `@padma.test`; ia membaca `.env.local` secara hardcoded sehingga tidak bisa
    nyasar, tapi jangan diakali.
14. Asap manual di ponsel sungguhan: buat undangan → login Google → buat sesi
    → unggah satu video kecil → tonton → cari alamat.

## 9. Verifikasi

Uji asap manual, **bukan** E2E. Delapan skenario E2E menulis dan menghapus
data lewat service role; mengarahkannya ke produksi berarti skrip uji
memegang database pasien. Ini keputusan sadar, bukan kelalaian.

Yang membuktikan rilis berhasil:

| Bukti | Menutup risiko |
|---|---|
| Katalog layanan merender kelima fase | §5, `phases` kosong |
| Login Google berhasil dari perangkat baru | §7, satu-satunya jalur akun klien |
| Klien membuka materinya sendiri | §3, hak bawaan tabel |
| Unggah video kecil berhasil dari peramban | R2 CORS |
| Pencarian alamat mengembalikan koordinat | §6, User-Agent Nominatim |
| Klien A tidak melihat data klien B | RLS di hosted |

## 10. Di luar cakupan

1. **Backup terjadwal.** Kodenya sudah ter-merge sejak 4 September, tapi tiga
   secret belum dipasang dan blok `schedule:` masih dikomentari. Pemilik
   memilih tidak menjadikannya gerbang rilis. Konsekuensinya lugas dan dicatat
   di sini: sejak klien pertama masuk sampai backup hidup, **tidak ada satu
   pun salinan rekam medis** — dashboard Supabase sendiri menulis "No
   backups", karena free tier tidak punya cadangan otomatis.
2. **Jalur lupa-password** untuk akun email+password. Tidak ada sama sekali.
3. Domain sendiri, migrasi otomatis (pendekatan C), E2E menembak produksi.
4. Lisensi komersial Vercel Hobby — keputusan sadar 31 Agustus 2026.
