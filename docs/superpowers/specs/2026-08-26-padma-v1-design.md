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
| 4 | Login klien | Email+password dan Google OAuth; akun dibuat admin dulu, penautan otomatis by email |
| 5 | Catatan sesi | Diinput **admin** (bidan lapor via WA/lisan). Mitra = data, bukan pengguna aplikasi |
| 6 | Panel owner | Rate card + rekap mingguan + tombol "tandai sudah dibayar" per mitra per pekan. Pembayaran klien: hanya pelacakan status manual (lihat #11), tanpa nominal & tanpa modul tagihan |
| 7 | QRIS | Level 1: QRIS statis (tampilkan gambar QR merchant, verifikasi mutasi manual). Gateway/QRIS dinamis = fase 2 |
| 8 | Landing | Satu halaman: hero, 5 lini layanan, alur, CTA skrining + WA |
| 9 | Stack | Next.js (App Router, TypeScript, Tailwind) + Supabase (Postgres, Auth, Storage), deploy Vercel |
| 10 | Konfirmasi bayar klien (28 Agu) | Manual berbasis status: klien menekan "Saya sudah bayar" di passport → status item menjadi `menunggu_verifikasi` + WhatsApp terbuka dengan teks siap kirim (bukti pembayaran dilampirkan klien di WA) → admin cek bukti/mutasi lalu mengubah status ke `lunas` secara manual. Nominal tidak pernah tampil di aplikasi — disampaikan via WA |
| 11 | Konfigurasi aplikasi (28 Agu) | Nomor WA resmi & pengaturan sejenis disimpan di tabel `app_settings` (DB), dapat diubah dari panel admin tanpa redeploy — bukan hardcode/env (env di Vercel butuh redeploy) |
| 12 | Master data & konten (28 Agu) | Katalog layanan diisi **dummy** dulu (dari mockup); client mengganti sendiri lewat panel admin saat live. Konten materi: dummy disiapkan tim dulu |
| 13 | Proteksi materi | Materi TIDAK dapat diunduh — hanya diakses di dalam aplikasi. E-book disimpan per-bab di database dan dirender in-app (bukan file PDF); video via embed terkunci domain (Vimeo) atau playback token berumur pendek (Cloudflare Stream), bukan YouTube unlisted. Setiap tampilan materi diberi watermark nama + PADMA ID klien agar kebocoran bisa dilacak. Catatan jujur: screenshot tidak bisa dicegah di platform mana pun — watermark adalah deterrent-nya |

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
| `/passport` | Klien | Identitas + PADMA ID, progres paket, riwayat sesi + catatan & rekomendasi, materi bonus, badge, blok "Cara Bayar" (QRIS statis) |
| `/admin` | Admin, Owner | Inbox skrining, kelola klien, kelola sesi & catatan, kelola mitra, kelola layanan & materi |
| `/owner` | Owner | Rate card, rekap honor mingguan, tanda bayar, margin |

Seluruh UI berbahasa Indonesia.

**Aktivasi akun klien:** admin membuat data klien (nama, email, no. HP, fase) → sistem menampilkan teks sambutan siap-salin untuk dikirim admin via WA → klien login Google / daftar email+password → server mencocokkan email ke `clients.email`, mengisi `clients.user_id`, redirect ke `/passport`. Login dengan email tak terdaftar → halaman "akun belum terhubung, hubungi admin" (bukan error mentah). Tidak ada pendaftaran klien mandiri.

## 5. Model Data

Prinsip: **uang dipisah secara struktural**. Tabel operasional tidak punya kolom uang; firewall ditegakkan RLS Postgres, bukan sekadar disembunyikan di UI.

### Tabel operasional (admin boleh akses)

- `clients` — id, `padma_id` (format `PAD-YYMM-NNNN`, digenerate sistem), nama, email (unik), no_hp, phase_id, user_id (nullable, FK auth.users, terisi saat penautan), created_at.
- `partners` — id, nama, no_hp, aktif. Mitra/bidan sebagai data.
- `phases` — lookup, seed 5 baris: Sankalpa/Prekonsepsi, Garbha/Kehamilan, Purnama/Nifas & Menyusui, Sandhya/Menopause, Shishu/Newborn Care.
- `services` — id, phase_id, nama, deskripsi, aktif. **Tanpa kolom uang.**
- `packages` — id, service_id, nama, jumlah_sesi, aktif.
- `client_packages` — id, client_id, package_id, tanggal_mulai, status (aktif|selesai|berhenti), `status_bayar` (`belum`|`menunggu_verifikasi`|`lunas`).
- `sessions` — id, client_id, service_id, client_package_id (nullable), partner_id, tanggal, status (`terjadwal`|`selesai`|`batal`), catatan (text), rekomendasi (text), `status_bayar` (hanya relevan untuk sesi lepas; sesi dalam paket mengikuti status paketnya), created_at, updated_at. **Tanpa kolom uang** — status_bayar adalah status, bukan nominal, jadi boleh dilihat admin.
- `app_settings` — key-value (nomor_wa, dst.), dapat diubah admin dari panel tanpa redeploy.
- `screenings` — id, kode (`PDM-…`, digenerate server), nama, no_hp, fase_skrining, jawaban (jsonb: id pertanyaan → ya/tidak), hasil (`hijau`|`merah`), flags (jsonb), status_tindak_lanjut (`baru`|`dihubungi`|`jadi_klien`|`ditolak`), client_id (nullable), created_at. Catatan: skrining hanya menawarkan 4 fase (prekonsepsi, kehamilan, nifas, menopause) sesuai mockup — fase Shishu tidak diskrining tersendiri karena yang diskrining adalah ibunya (masuk fase Nifas).
- `materials` — id, judul, tipe (`ebook`|`video`), service_id, deskripsi, aktif. E-book: konten terstruktur per-bab di tabel `material_chapters` (id, material_id, urutan, judul, isi) — bukan file. Video: `video_url` penyedia terproteksi (Vimeo domain-locked / Cloudflare Stream).

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
5. **Materi bonus.** Klien melihat materi dari layanan yang punya sesi `selesai` saja (materi tidak bocor sebelum layanan berjalan). Semua materi **hanya bisa diakses di dalam aplikasi — tanpa unduhan**: e-book dirender per-bab dari database lewat endpoint terautentikasi (tidak ada file/URL yang bisa disebar), video diputar via embed terkunci domain atau playback token berumur pendek. Setiap tampilan diberi watermark identitas klien; teks reader dibuat non-selectable sebagai deterrent tambahan.

## 7. Keamanan

- RLS di semua tabel. Klien: hanya baris miliknya (via `user_id`). Admin: CRUD tabel operasional; `service_rates` & `honor_marks` ditolak di level DB. Owner: penuh.
- Data skrining = data kesehatan (relevan UU PDP): koleksi minimal, akses hanya admin/owner, tidak tampil di URL/log.
- Endpoint skrining publik: validasi Zod + rate limit sederhana.
- Proteksi materi (keputusan #13): tidak ada file materi yang bisa diunduh/disebar — e-book per-bab dari DB via endpoint terautentikasi, video via penyedia terproteksi, watermark identitas klien di setiap tampilan, teks non-selectable + blokir klik-kanan sebagai deterrent. Bila kelak ditemukan bocoran, watermark mengidentifikasi akun sumbernya.
- Kunci service-role hanya di server. Semua mutasi lewat server (route handler / server action), bukan langsung dari browser dengan anon key untuk tabel sensitif.

## 8. Error Handling & Empty State

- Gagal simpan skrining → klien tetap melihat hasil + tombol WA (funnel tidak boleh mati); kegagalan dicatat untuk dicek.
- Email tak terdaftar saat login → halaman ramah berisi kontak WA admin.
- Semua halaman punya empty state yang dirancang (passport tanpa sesi, inbox kosong, rekap kosong) — minggu awal data memang kosong.

## 9. Testing

- Unit: logika hasil skrining (urgent/review per fase), kalkulasi rekap mingguan dengan riwayat tarif, progres paket.
- **Test firewall (terpenting):** integrasi yang login sebagai admin dan membuktikan query ke `service_rates`/`honor_marks` ditolak RLS.
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
