# PADMA v1 — Design Doc

Tanggal: 26 Agustus 2026
Status: menunggu review
Bahan sumber: poster "Digital Care Passport PADMA" + 2 mockup client (`documents/mockups/padma-1.html`, `documents/mockups/padma-2.html`)

## 1. Konteks

PADMA adalah klinik promil/wellness homecare premium untuk perempuan (prekonsepsi, kehamilan, nifas, menopause, newborn care). Layanan diberikan mitra (bidan) yang datang ke rumah klien. Komunikasi dan booking berjalan lewat WhatsApp.

Client (orang awam) membuat mockup via prompting AI; mockup itu menjadi bahan mentah, bukan spesifikasi. Dokumen ini adalah hasil bedah dan penyederhanaan mockup tersebut oleh tim developer, dengan keputusan yang sudah disepakati.

Platform v1: **website**. Mobile menjadi kemungkinan fase berikutnya — arsitektur dipilih agar backend yang sama bisa dipakai ulang aplikasi mobile.

## 2. Keputusan yang Sudah Disepakati

| # | Topik | Keputusan |
|---|---|---|
| 1 | Scope v1 | Semua modul: landing 1 halaman, skrining, passport klien, panel admin, panel owner |
| 2 | Hasil skrining | Disimpan ke server (nama + no. HP, tanpa login); admin verifikasi via kode skrining. Lock localStorage 24 jam dari mockup dibuang |
| 3 | Model penjualan | Dibangun **hybrid** (paket & sesi lepas) dari awal — diputuskan 28 Agu; konfirmasi client berjalan paralel, tidak memblokir |
| 4 | Login klien (direvisi 28 Agu 2026) | Email+password dan Google OAuth; akun dibuat admin dulu, lalu diaktifkan klien lewat **tautan undangan bertoken sekali-pakai** yang dikirim admin via WhatsApp. Penautan hanya terjadi bila token sah **dan** email cocok persis. **Penautan otomatis by email dibatalkan** — lihat penjelasan di bawah tabel |
| 5 | Catatan sesi | Diinput **admin** (bidan lapor via WA/lisan). Mitra = data, bukan pengguna aplikasi |
| 6 | Panel owner | Rate card + rekap mingguan + tombol "tandai sudah dibayar" per mitra per pekan. Pembayaran klien: hanya pelacakan status manual (lihat #11), tanpa nominal & tanpa modul tagihan |
| 7 | QRIS | Level 1: QRIS statis (tampilkan gambar QR merchant, verifikasi mutasi manual). Gateway/QRIS dinamis = fase 2 |
| 8 | Landing | Satu halaman: hero, 5 lini layanan, alur, CTA skrining + WA |
| 9 | Stack | Next.js (App Router, TypeScript, Tailwind) + Supabase (Postgres, Auth, Storage), deploy Vercel |
| 10 | Konfirmasi bayar klien (28 Agu) | Manual berbasis status: klien menekan "Saya sudah bayar" di passport → status item menjadi `menunggu_verifikasi` + WhatsApp terbuka dengan teks siap kirim (bukti pembayaran dilampirkan klien di WA) → admin cek bukti/mutasi lalu mengubah status ke `lunas` secara manual. Nominal tidak pernah tampil di aplikasi — disampaikan via WA |
| 11 | Konfigurasi aplikasi (28 Agu) | Nomor WA resmi & pengaturan sejenis disimpan di tabel `app_settings` (DB), dapat diubah dari panel admin tanpa redeploy — bukan hardcode/env (env di Vercel butuh redeploy) |
| 12 | Master data & konten (28 Agu) | Katalog layanan diisi **dummy** dulu (dari mockup); client mengganti sendiri lewat panel admin saat live. Konten materi: dummy disiapkan tim dulu |
| 13 | Proteksi materi | Materi TIDAK dapat diunduh — hanya diakses di dalam aplikasi. E-book disimpan per-bab di database dan dirender in-app (bukan file PDF); video via embed terkunci domain (Vimeo) atau playback token berumur pendek (Cloudflare Stream), bukan YouTube unlisted. Setiap tampilan materi diberi watermark nama + PADMA ID klien agar kebocoran bisa dilacak. Catatan jujur: screenshot tidak bisa dicegah di platform mana pun — watermark adalah deterrent-nya |

### Keputusan #4 — kenapa "penautan otomatis by email" dibatalkan (28 Agu 2026)

Keputusan #4 versi awal berbunyi "penautan otomatis by email": klien login dengan email apa pun, server mencari baris `clients` beremail sama, lalu mengisi `clients.user_id`. Model itu **dibatalkan karena terbukti membocorkan rekam medis pasien**, bukan karena kekhawatiran teoretis. Eksploitnya dijalankan di stack lokal dan outputnya nyata:

```
1. self-signup email klien   : BERHASIL
   email_confirmed_at        : TERKONFIRMASI OTOMATIS
2. linkClientByEmail()       : TERTAUT ke rekam Rina
3. penyerang membaca PII     : [{"nama":"Rina Hapsari","no_hp":"0857-0000-1111"}]
4. penyerang membaca medis   : [{"catatan":"RAHASIA MEDIS: riwayat keguguran 2024, TD 130/85",
                                 "rekomendasi":"Fe + folat, kontrol 2 minggu"}]
```

Yang penting: **cara mencocokkan emailnya sudah benar.** Perbaikan sebelumnya (`.eq()` atas email ternormalisasi, tahan wildcard `%`/`_`, tahan beda kapitalisasi) tidak bisa disalahkan di sini. Yang runtuh adalah **asumsi di baliknya** — bahwa email yang dipakai login benar-benar milik orang itu. Asumsi itu salah karena dua alasan yang saling menguatkan:

1. `[auth.email] enable_confirmations = false` membuat GoTrue **meng-auto-confirm** setiap pendaftaran mandiri tanpa bukti kepemilikan apa pun;
2. alamat email klien mudah **ditebak** (nama depan + domain), dan bahkan bila tidak, klien memberikannya ke banyak pihak. Alamat email adalah **pengenal**, bukan **rahasia** — jadi mencocokkannya bukan otentikasi.

**Model pengganti: token undangan sekali-pakai.** Model ini justru lebih setia pada alur bisnis yang sudah ada di bagian 4 — admin membuat data klien lalu mengirim pesan sambutan via WhatsApp. Isi pesan itu sekarang memuat tautan aktivasi bertoken:

- Saat admin membuat/mengundang klien, server menerbitkan token acak kriptografis (32 byte, base64url) berumur 14 hari, sekali pakai. Yang tersimpan di DB hanya SHA-256-nya.
- Token dikirim lewat **kanal terpisah** dari email login (WhatsApp — nomor HP yang admin catat sendiri saat klien mendaftar). Penyerang yang menebak email tidak memegang kanal itu.
- Penautan terjadi **hanya** bila token sah (ada, belum kedaluwarsa, belum dipakai, baris kliennya belum tertaut) **dan** email pengguna cocok persis dengan email klien pada baris token itu. Token dan email harus sepakat; **email saja tidak pernah cukup** — inilah inti perbaikannya.
- Semua penolakan mengembalikan hasil yang sama, sehingga penyerang tidak bisa membedakan "token tidak ada", "kedaluwarsa", "sudah dipakai", atau "email tidak cocok".

**Lapis kedua: konfirmasi email dinyalakan** (`enable_confirmations = true`). Ini bukan pengganti token, melainkan mencegah penyerang **menduduki** alamat email klien sebelum kliennya sempat aktivasi (squatting yang bisa mengunci klien asli keluar dari emailnya sendiri). Dinyalakan setelah diuji sungguhan — lihat bagian 7.

## 3. Yang Sengaja Dipangkas dari Mockup/Poster (v1)

- **QR code di passport** — tidak ada use case nyata.
- **Notifikasi in-app** — kabar ke klien lewat WA.
- **Status "On Track"** — progres % (untuk klien berpaket) sudah cukup; label status tanpa definisi dibuang.
- **Lock hasil skrining 24 jam di perangkat** — digantikan penyimpanan server.
- **Modul tagihan bernominal** — tetap di luar v1; yang masuk hanya pelacakan status pembayaran manual (keputusan #10).
- **Akun untuk mitra/bidan** — fase 2 bila diperlukan.
- **Sertifikat/badge**: tetap ada tapi dalam bentuk paling sederhana (badge per layanan yang pernah selesai, derived, tanpa tabel sendiri).

## 4. Peran & Struktur Aplikasi

Tiga peran: `klien`, `admin`, `owner`. Owner adalah superset admin (bisa membuka semua halaman admin). Peran tersimpan di profil pengguna, dibawa di klaim JWT, dicek di middleware rute **dan** di kebijakan per-query (defense in depth).

| Rute | Akses | Isi |
|---|---|---|
| `/` | Publik | Landing: hero, 5 lini layanan, alur kerja, CTA "Mulai Skrining" + tombol WA |
| `/skrining` | Publik | Wizard skrining; konten pertanyaan & logika persis mockup 2 |
| `/masuk` | Publik | Login semua peran: email+password & Google |
| `/aktivasi?token=…` | Publik | Titik masuk tautan aktivasi dari pesan WhatsApp. Memindahkan token ke cookie httpOnly (umur 1 jam) lalu mengarahkan ke `/masuk` — token tidak ikut di URL halaman berikutnya (riwayat browser, Referer, log akses) |
| `/setelah-masuk` | Semua yang login | Pengarah pasca-login: owner → `/owner`, admin → `/admin`, klien → `/passport` bila sudah tertaut; bila belum, penautan dicoba dengan token dari cookie, gagal → `/akun-belum-terhubung` |
| `/akun-belum-terhubung` | Semua yang login | Halaman ramah: "buka tautan aktivasi dari WhatsApp lebih dulu", plus tombol keluar. Bukan error mentah |
| `/passport` | Klien | Identitas + PADMA ID, progres paket, riwayat sesi + catatan & rekomendasi, materi bonus, badge, blok "Cara Bayar" (QRIS statis) |
| `/admin` | Admin, Owner | Inbox skrining, kelola klien, kelola sesi & catatan, kelola mitra, kelola layanan & materi |
| `/owner` | Owner | Rate card, rekap honor mingguan, tanda bayar, margin |

Seluruh UI berbahasa Indonesia.

**Aktivasi akun klien (direvisi 28 Agu 2026 — wajib token undangan):**

1. Admin membuat data klien (nama, email, no. HP, fase). Server sekaligus menerbitkan **token undangan**: 32 byte acak kriptografis (base64url), berlaku 14 hari, sekali pakai. Yang disimpan DB hanya SHA-256-nya; token polosnya hanya ada satu kali, yaitu pada nilai balik pembuatan undangan.
2. Sistem menampilkan teks sambutan siap-salin berisi **tautan aktivasi** `/aktivasi?token=…` untuk dikirim admin via WhatsApp ke nomor HP klien. WhatsApp adalah kanal terpisah dari email login — itulah yang membuat model ini aman.
3. Klien membuka tautan → token pindah ke cookie httpOnly → klien login (Google atau email+password).
4. `/setelah-masuk` menautkan **hanya** bila token sah **dan** email pengguna cocok persis (setelah normalisasi trim + huruf kecil) dengan email klien pada baris token itu. Sukses: `clients.user_id` terisi, `clients.linked_at` terisi, token dimatikan (tidak bisa dipakai ulang), redirect `/passport`.
5. Login **kedua dan seterusnya** tidak membawa token: pengenalan memakai `clients.user_id` — identitas yang sudah dibuktikan token pada aktivasi — **bukan** email.
6. Gagal (tidak ada token, token salah/kedaluwarsa/sudah dipakai, email tidak cocok, atau email tak terdaftar) → halaman ramah `/akun-belum-terhubung` yang meminta klien membuka tautan aktivasi atau menghubungi admin lewat WhatsApp. Bukan error mentah, dan tanpa memberi tahu penyebab spesifiknya.

Tidak ada pendaftaran klien mandiri. Mendaftar sendiri dengan email klien tidak memberi akses apa pun: tanpa token, tidak ada penautan, sehingga RLS `clients.user_id = auth.uid()` tidak pernah mengembalikan baris klien mana pun.

Klien yang tautannya kedaluwarsa/sudah dipakai: admin menerbitkan undangan baru (upsert pada `client_invites`, satu undangan hidup per klien) dan mengirim ulang lewat WhatsApp.

## 5. Model Data

Prinsip: **uang dipisah secara struktural**. Tabel operasional tidak punya kolom uang; firewall ditegakkan RLS Postgres, bukan sekadar disembunyikan di UI.

### Tabel operasional (admin boleh akses)

- `clients` — id, `padma_id` (format `PAD-YYMM-NNNN`, digenerate sistem), nama, email (unik, disimpan ternormalisasi huruf kecil — ditegakkan trigger + constraint), no_hp, phase_id, user_id (nullable, FK auth.users, terisi saat penautan), `linked_at` (timestamptz nullable — waktu akun tertaut; NULL = belum diaktifkan, dipakai admin untuk melihat siapa yang belum aktivasi), created_at.
- `client_invites` — client_id (PK, FK `clients`, on delete cascade), `token_hash` (unik, nullable — SHA-256 token undangan; **NULL sesudah dipakai** sehingga tidak ada lagi yang bisa dicocokkan), `expires_at`, created_at, `used_at`, `used_by` (FK auth.users). Constraint `check ((used_at is null) = (token_hash is not null))` menegakkan invarian "sekali pakai" di level DB, bukan hanya di aplikasi. Satu klien = paling banyak satu undangan hidup; menerbitkan ulang membatalkan yang lama.
  - **Tokennya tinggal di tabel sendiri, bukan sebagai kolom `clients`.** Alasannya diuji langsung, bukan diasumsikan: hak kolom di Postgres baru berlaku bila hak SELECT tingkat tabel dicabut lebih dulu, dan begitu itu dilakukan `select *` gagal `ERROR: permission denied for table clients` (42501) — untuk klien **maupun** admin. Ini kesimpulan yang sama dengan `materials.video_url` (lihat `material_videos` di bawah): mencabut GRANT kolom tidak menyembunyikan kolom, ia mematahkan query. Pola tabel-terpisah dipilih karena tidak mematahkan satu pun query yang sudah ada.
  - `anon` **dan** `authenticated` tidak punya hak apa pun atas tabel ini (termasuk admin & owner, yang login sebagai `authenticated` juga — tidak ada alur produk yang mengharuskan token terbaca dari browser). RLS aktif tanpa satu pun policy, jadi aksesnya ditolak dua kali: hak tabel dan RLS. Hanya service role di server yang bisa menyentuhnya.
- `partners` — id, nama, no_hp, aktif. Mitra/bidan sebagai data.
- `phases` — lookup, seed 5 baris: Sankalpa/Prekonsepsi, Garbha/Kehamilan, Purnama/Nifas & Menyusui, Sandhya/Menopause, Shishu/Newborn Care.
- `services` — id, phase_id, nama, deskripsi, aktif. **Tanpa kolom uang.**
- `packages` — id, service_id, nama, jumlah_sesi, aktif.
- `client_packages` — id, client_id, package_id, tanggal_mulai, status (aktif|selesai|berhenti), `status_bayar` (`belum`|`menunggu_verifikasi`|`lunas`).
- `sessions` — id, client_id, service_id, client_package_id (nullable), partner_id, tanggal, status (`terjadwal`|`selesai`|`batal`), catatan (text), rekomendasi (text), `status_bayar` (hanya relevan untuk sesi lepas; sesi dalam paket mengikuti status paketnya), created_at, updated_at. **Tanpa kolom uang** — status_bayar adalah status, bukan nominal, jadi boleh dilihat admin.
- `app_settings` — key-value (nomor_wa, dst.), dapat diubah admin dari panel tanpa redeploy.
- `booking_requests` — id, client_id, service_id, tanggal, preferensi_waktu (`pagi`|`siang`|`sore`), catatan, status (`menunggu`|`dikonfirmasi`|`ditolak`), created_at. Klien mengajukan jadwal dari passport; admin mengonfirmasi (memilih mitra) sehingga menjadi baris `sessions` berstatus `terjadwal`. Ini permintaan, bukan booking final — kesepakatan tetap via WhatsApp.
- `screenings` — id, kode (`PDM-…`, digenerate server), nama, no_hp, fase_skrining, jawaban (jsonb: id pertanyaan → ya/tidak), hasil (`hijau`|`merah`), flags (jsonb), status_tindak_lanjut (`baru`|`dihubungi`|`jadi_klien`|`ditolak`), client_id (nullable), created_at. Catatan: skrining hanya menawarkan 4 fase (prekonsepsi, kehamilan, nifas, menopause) sesuai mockup — fase Shishu tidak diskrining tersendiri karena yang diskrining adalah ibunya (masuk fase Nifas).
- `materials` — id, judul, tipe (`ebook`|`video`), service_id, deskripsi, aktif. **Hanya metadata** — tidak ada kolom isi maupun URL, karena baris ini sengaja terbaca semua user login agar UI bisa menampilkan kartu materi dalam keadaan **terkunci** (judul/tipe/deskripsi tampak, isinya tidak).
- `material_chapters` — id, material_id, urutan, judul, isi. Isi e-book per-bab di database (bukan file).
- `material_videos` — material_id (PK, FK ke `materials`), url, created_at. URL video penyedia terproteksi (Vimeo domain-locked / Cloudflare Stream).
  - Isi materi **wajib** tinggal di tabel terpisah seperti dua tabel di atas, bukan sebagai kolom pada `materials`. RLS Postgres bekerja per-BARIS, bukan per-kolom: policy "baca meta" (`auth.uid() is not null`) yang membuka baris `materials` otomatis membuka **semua** kolomnya. Kolom `materials.video_url` yang sempat ada karena itu membocorkan URL video layanan yang belum pernah dijalani klien — ditutup lewat migration `gate_material_video` yang memindahkannya ke `material_videos`. Mencabut GRANT kolom bukan solusi: `select *` jadi gagal `42501 permission denied`, bukan menyembunyikan kolom, sehingga daftar materi ikut mati.
  - `material_chapters` dan `material_videos` memakai gating yang identik: klien hanya boleh SELECT bila ada baris `sessions` berstatus `selesai` miliknya pada `service_id` materi tersebut; staf (admin/owner) kelola penuh; anon tidak punya hak tabel sama sekali.

### Tabel uang (hanya owner)

- `service_rates` — id, service_id, harga_klien, honor_mitra, `berlaku_sejak` (date). Edit rate card = insert baris baru, tidak update baris lama.
- `honor_marks` — id, partner_id, week_start (date, Senin), dibayar_pada, ditandai_oleh.

### Nilai derived (tidak disimpan)

- Progres paket = sesi `selesai` dalam paket ÷ `jumlah_sesi`.
- Badge = daftar layanan dengan ≥1 sesi `selesai` milik klien.
- Rekap mingguan & margin = agregasi sesi `selesai` per pekan (Senin–Minggu) × tarif yang `berlaku_sejak` ≤ tanggal sesi (tarif termutakhir pada tanggal itu).

## 6. Alur Kunci

1. **Skrining → calon klien.** Pengunjung isi nama + no. HP → pilih fase → jawab pertanyaan universal + per-fase (level `urgent` menghentikan skrining seketika, `review` menandai) → hasil Hijau/Merah tersimpan ke `screenings` → tombol WA membuka chat berisi kode skrining. Admin menemukan entri di inbox, memverifikasi jawaban asli, memperbarui status tindak lanjut. Hasil Merah dengan flag urgent tetap menampilkan blok darurat 119 seperti mockup.
2. **Siklus sesi.** Admin membuat sesi `terjadwal` → setelah kunjungan, bidan lapor via WA → admin set `selesai` + isi catatan & rekomendasi → efek berantai otomatis: muncul di passport, progres paket bertambah, badge terbit, materi layanan terbuka, masuk rekap owner. Sesi `batal` tidak dihitung apa pun.
3. **Rekap owner.** Per pekan per mitra: jumlah sesi selesai × honor (tarif historis) → total dibayar Sabtu; margin = Σharga − Σhonor. "Tandai dibayar" mengisi `honor_marks`.
4. **Konfirmasi pembayaran.** Halaman Bayar di passport menampilkan item tagihan klien (paket / sesi lepas) berikut statusnya — tanpa nominal (nominal disampaikan admin via WA). Klien menekan "Saya sudah bayar" → status jadi `menunggu_verifikasi` dan WhatsApp terbuka dengan teks siap kirim; klien melampirkan bukti di WA → admin memeriksa bukti/mutasi lalu mengubah status ke `lunas` di panel admin.
5. **Materi bonus.** Klien melihat **daftar** seluruh materi termasuk yang belum terbuka (kartu berstatus terkunci: judul, tipe, deskripsi), tetapi **isinya** — bab e-book (`material_chapters`) dan URL video (`material_videos`) — hanya untuk layanan yang punya sesi `selesai` miliknya (materi tidak bocor sebelum layanan berjalan). Pemisahan meta vs isi ke tabel berbeda inilah yang menegakkannya di level RLS. Semua materi **hanya bisa diakses di dalam aplikasi — tanpa unduhan**: e-book dirender per-bab dari database lewat endpoint terautentikasi (tidak ada file/URL yang bisa disebar), video diputar via embed terkunci domain atau playback token berumur pendek. Setiap tampilan diberi watermark identitas klien; teks reader dibuat non-selectable sebagai deterrent tambahan.

## 7. Keamanan

- RLS di semua tabel. Klien: hanya baris miliknya (via `user_id`). Admin: CRUD tabel operasional; `service_rates` & `honor_marks` ditolak di level DB. Owner: penuh.
- Data skrining = data kesehatan (relevan UU PDP): koleksi minimal, akses hanya admin/owner, tidak tampil di URL/log.
- Endpoint skrining publik: validasi Zod + rate limit sederhana.
- Proteksi materi (keputusan #13): tidak ada file materi yang bisa diunduh/disebar — e-book per-bab dari DB via endpoint terautentikasi, video via penyedia terproteksi, watermark identitas klien di setiap tampilan, teks non-selectable + blokir klik-kanan sebagai deterrent. Bila kelak ditemukan bocoran, watermark mengidentifikasi akun sumbernya.
- **Penautan akun klien wajib token undangan sekali-pakai — pencocokan email tidak pernah cukup.** Dua celah berturut-turut di titik yang sama, dengan akar yang berbeda:
  1. **Pola, bukan kesetaraan.** Penautan pernah memakai `.ilike("email", …)` yang oleh PostgREST menjadi SQL LIKE: cukup mendaftar mandiri dengan email `%@padma.test` untuk menautkan akun penyerang ke baris klien orang lain berikut catatan sesinya. Ditutup dengan normalisasi email di DB (trigger + constraint) lalu `.eq()` — tetap buta kapitalisasi, tapi `%`/`_` tidak lagi wildcard. **Aturan itu tetap berlaku** untuk setiap pencarian identitas (email, PADMA ID, kode skrining).
  2. **Asumsi kepemilikan email.** Pencocokan persis pun tidak cukup: dengan `enable_confirmations = false`, GoTrue meng-auto-confirm pendaftaran mandiri tanpa bukti kepemilikan, jadi menebak `rina@padma.test` sudah cukup untuk merebut rekamnya — terbukti sampai terbacanya `"RAHASIA MEDIS: riwayat keguguran 2024, TD 130/85"` (lihat eksploit lengkap di bawah tabel keputusan). Alamat email adalah **pengenal, bukan rahasia**. Ditutup dengan token undangan: rahasia acak 32 byte, disimpan sebagai SHA-256, berumur 14 hari, sekali pakai, dikirim lewat kanal terpisah (WhatsApp), dan penautan menuntut token **dan** email sepakat. Klaim "sekali pakai" dijaga UPDATE bersyarat atomik (`... where token_hash = $1 and used_at is null`), sehingga dua permintaan bersamaan hanya menghasilkan satu pemenang.
  - Login berikutnya dikenali lewat `clients.user_id`, **bukan** email — mencari lewat email di jalur itu akan menghidupkan kembali celah yang baru ditutup.
  - Baris klien yang sudah tertaut tidak bisa ditautkan ulang: tidak ada jalur perebutan lewat undangan baru.
- **Konfirmasi email `enable_confirmations = true` (dinyalakan 28 Agu 2026, sesudah diuji).** Uji dijalankan terhadap instance GoTrue **terisolasi** (image sama v2.196.0, database terpisah — stack lokal tidak di-restart), membandingkan `MAILER_AUTOCONFIRM` false vs true:
  - `auth.admin.createUser({ email_confirm: true })` (dipakai `scripts/seed-users.ts`): HTTP 200, `email_confirmed_at` terisi, login dapat sesi → **tidak patah**.
  - Login provider eksternal (OAuth) **pertama kali**: kembali ke aplikasi dengan `#access_token=…` → **tidak patah**. Diuji lewat provider OIDC palsu karena GoTrue memakai satu jalur kode yang sama untuk semua provider eksternal dan menandai email dari provider sebagai terverifikasi — sama seperti Google.
  - Pendaftaran mandiri email+sandi: `false` → `email_confirmed_at` kosong, tanpa sesi, login ditolak `email_not_confirmed`; `true` → langsung terkonfirmasi dan langsung dapat sesi. **Hanya perilaku inilah yang berubah** — persis lubang yang ditutup.
  - Fungsinya lapis kedua, bukan perisai utama: ia mencegah penyerang menduduki alamat email klien sebelum kliennya aktivasi. Perisai utamanya tetap token undangan.
  - Catatan operasional: mengubah `supabase/config.toml` baru berlaku sesudah `supabase stop && supabase start` (env container GoTrue dibuat ulang). Test suite sengaja tidak bergantung pada setelan ini — user uji dibuat lewat service role dengan `email_confirm` — jadi `npm test` hijau di kedua keadaan.
- `enable_signup` sengaja **tetap menyala**: diuji 28 Agu 2026, mematikannya menolak login Google pertama kali (`signup_disabled`) sehingga aktivasi akun klien (keputusan #4) mati; pembuatan user oleh admin lewat service role tetap jalan. Perisai kebocoran adalah token undangan di atas, bukan tertutupnya pendaftaran.
- **Token tidak boleh bocor lewat REST.** `client_invites` tertutup untuk `anon` dan `authenticated` di level hak tabel **dan** RLS (aktif tanpa policy). Token hanya dikirim ke admin sekali, saat undangan dibuat, untuk ditempel ke pesan WhatsApp. Yang tersimpan di DB hanya SHA-256-nya, jadi dump/backup yang bocor tidak berisi kunci siap pakai. Token juga tidak dibiarkan menetap di URL: `/aktivasi` memindahkannya ke cookie httpOnly lalu mengarahkan ulang.
- Kunci service-role hanya di server. Semua mutasi lewat server (route handler / server action), bukan langsung dari browser dengan anon key untuk tabel sensitif.

## 8. Error Handling & Empty State

- Gagal simpan skrining → klien tetap melihat hasil + tombol WA (funnel tidak boleh mati); kegagalan dicatat untuk dicek.
- Email tak terdaftar saat login → halaman ramah berisi kontak WA admin.
- Semua halaman punya empty state yang dirancang (passport tanpa sesi, inbox kosong, rekap kosong) — minggu awal data memang kosong.

## 9. Testing

- Unit: logika hasil skrining (urgent/review per fase), kalkulasi rekap mingguan dengan riwayat tarif, progres paket.
- **Test firewall (terpenting):** integrasi yang login sebagai admin dan membuktikan query ke `service_rates`/`honor_marks` ditolak RLS.
- **Test penautan akun klien (`tests/penautan-undangan.test.ts`):** mereproduksi eksploit apa adanya — penyerang self-signup dengan email klien — lalu membuktikan kegagalannya **sampai lapisan data**, bukan sekadar dari nilai balik fungsi: query PostgREST sebagai penyerang harus mengembalikan 0 baris `clients` dan 0 baris `sessions`, dan teks catatan medis tidak boleh muncul di mana pun. Ditambah: token salah/kedaluwarsa/sudah dipakai ditolak; token benar + email tidak cocok ditolak; token benar + email cocok tertaut lalu mati (percobaan kedua ditolak); `select *` pada `clients` tetap jalan untuk klien & admin (jebakan hak kolom). Skenario aktivasi juga diuji lewat browser sungguhan di `npm run test:e2e`.
- E2E (Playwright), happy path: skrining→hasil tersimpan; login klien→passport; admin buat & selesaikan sesi→muncul di passport & rekap.

## 10. Pertanyaan Client — Status Jawaban (per 28 Agu 2026)

Enam pertanyaan awal sudah dijawab keputusan internal (pembangunan tidak terblokir); dua hal masih menunggu konfirmasi client:

1. **Model penjualan** → dibangun hybrid (paket & sesi lepas) dari awal. *Konfirmasi client berjalan paralel.*
2. **Katalog layanan & penamaan** → diisi dummy dari mockup; client mengganti sendiri lewat panel admin saat live. *Daftar final menunggu client.*
3. **Materi e-book & video** → konten dummy disiapkan tim dulu; konten asli menyusul dari client.
4. **Pembayaran klien** → manual berbasis status (keputusan #10): tombol "Saya sudah bayar" → WA + bukti → admin verifikasi & ubah status manual.
5. **QRIS** → manual, client **sudah punya merchant QRIS**. QR statis ditampilkan di halaman Bayar; konfirmasi otomatis/gateway tetap fase 2.
6. **Nomor WA resmi** → dibuat konfigurable via `app_settings` (keputusan #11); nomor final tinggal diisi kapan saja dari panel admin.

## 11. Deployment & Seed

- **Keputusan (28 Agu 2026): Vercel dipakai untuk production.** Development & demo di tier Hobby (gratis); saat go-live upgrade ke Pro (~$20/bulan) karena tier gratis tidak boleh untuk penggunaan komersial. Custom domain client dipasang di Vercel (SSL otomatis). Opsi deployment lain (VPS dsb.) ditunda — dievaluasi lagi nanti bila diperlukan.
- Supabase cloud (DB/Auth/Storage), free tier dulu — batasannya kapasitas, bukan komersialitas; cukup untuk skala awal.
- Estimasi biaya operasional go-live untuk client: ~Rp 350–400rb/bulan (Vercel Pro) + domain ~Rp 200rb/tahun.
- Seed: 5 fase, katalog layanan **dummy** dari mockup (Lactation Hero, Garbha Relief, Shishu Parent Touch, Flow Yoga Intro, Return to Work) berikut tarif contohnya, nilai awal `app_settings` (nomor WA), 1 akun owner, 1 akun admin. Client mengganti isi dummy sendiri lewat panel admin saat live.
- Preview deployment Vercel dipakai untuk demo ke client.

## 12. Di Luar Scope v1 (fase 2 dan seterusnya)

Tagihan + QRIS dinamis via gateway, pelacakan pembayaran klien, akun mitra, rating/ulasan klien, notifikasi, aplikasi mobile (React Native/Expo, memakai backend Supabase yang sama), landing multi-halaman/artikel.
